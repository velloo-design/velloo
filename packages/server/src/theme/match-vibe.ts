import { err, ok, type Result } from "@velloo/result";
import type { Theme } from "@velloo/schema";
import { parse } from "culori";
import type { DesignFolder } from "../design-folder.ts";
import { persistTheme } from "../mutations/persist.ts";
import { derivePalette } from "./derive-palette.ts";
import { invalidThemePath, type ThemeError } from "./errors.ts";
import { scoreVibe, VIBE_TABLE, type VibeEntry } from "./vibe-table.ts";

export interface MatchVibeOpts {
  /** When true and ANTHROPIC_API_KEY is set, ask Claude for a seed first. */
  useAi?: boolean;
}

export interface MatchVibeResult {
  matched: { keywords: string[]; seed: string; description: string; source: "heuristic" | "ai" };
  theme: Theme;
  adjustments: Array<{ slot: string; from: string; to: string }>;
}

const HAIKU_MODEL = "claude-haiku-4-5";

async function llmSuggestSeed(
  description: string,
): Promise<{ seed: string; rationale: string } | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;

  const prompt = [
    "You are a design-system color generator. Given a short vibe description, return JSON with one OKLCH seed color.",
    "Output strict JSON only, no prose:",
    '  {"seed":"oklch(L C H)","rationale":"<one short sentence>"}',
    "L must be 0..1, C must be 0..0.4, H must be 0..360.",
    `Vibe: ${description}`,
  ].join("\n");

  let body: { content?: Array<{ type: string; text?: string }> };
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: HAIKU_MODEL,
        max_tokens: 200,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) return null;
    body = (await res.json()) as never;
  } catch {
    return null;
  }

  const text = body.content?.find((c) => c.type === "text")?.text;
  if (!text) return null;
  // Extract the first {...} block.
  const match = text.match(/\{[\s\S]*?\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as { seed?: string; rationale?: string };
    if (!parsed.seed || !parse(parsed.seed)) return null;
    return { seed: parsed.seed, rationale: parsed.rationale ?? "" };
  } catch {
    return null;
  }
}

export async function matchVibe(
  folder: DesignFolder,
  description: string,
  opts: MatchVibeOpts = {},
): Promise<Result<MatchVibeResult, ThemeError>> {
  if (!description.trim()) {
    return err(invalidThemePath("match_vibe: description is required"));
  }

  let chosen: { seed: string; description: string; keywords: string[]; source: "heuristic" | "ai" };

  if (opts.useAi) {
    const ai = await llmSuggestSeed(description);
    if (ai) {
      chosen = {
        seed: ai.seed,
        description: ai.rationale || description,
        keywords: [description],
        source: "ai",
      };
    } else {
      const heuristic = scoreVibe(description) ?? defaultVibe();
      chosen = { ...vibeEntryToChoice(heuristic.entry), source: "heuristic" };
    }
  } else {
    const heuristic = scoreVibe(description) ?? defaultVibe();
    chosen = { ...vibeEntryToChoice(heuristic.entry), source: "heuristic" };
  }

  const derivedR = derivePalette(chosen.seed, folder.theme, folder.theme.name);
  if (!derivedR.ok) return derivedR;
  const persisted = await persistTheme(folder, derivedR.value.theme);

  return ok({
    matched: {
      keywords: chosen.keywords,
      seed: chosen.seed,
      description: chosen.description,
      source: chosen.source,
    },
    theme: persisted,
    adjustments: derivedR.value.adjustments,
  });
}

function vibeEntryToChoice(entry: VibeEntry): {
  seed: string;
  description: string;
  keywords: string[];
} {
  return { seed: entry.seed, description: entry.description, keywords: entry.keywords };
}

function defaultVibe(): { entry: VibeEntry; score: number } {
  // No keyword match → fall back to the neutral "minimal" vibe.
  const entry =
    VIBE_TABLE.find((e) => e.keywords.includes("minimal")) ?? (VIBE_TABLE[0] as VibeEntry);
  return { entry, score: 0 };
}
