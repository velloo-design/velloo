/**
 * AI-generated SVG markup via Anthropic Claude.
 *
 * Given a natural-language prompt ("a friendly cloud", "an abstract
 * geometric crystal", "a hand-drawn arrow"), asks Claude Haiku for
 * the inline SVG body (without the outer <svg> wrapper — that's
 * supplied by the Velloo `<SVG content=…>` helper). The result is
 * either returned as an inline string the agent can stamp into a
 * tree, or written to `assets/<name>.svg` and the helper returns the
 * relative path.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { err, ok, type Result } from "@velloo/result";
import type { DesignFolder } from "../design-folder.ts";

const HAIKU_MODEL = "claude-haiku-4-5";
const MAX_TOKENS = 1500;

export interface GenerateSvgOptions {
  /**
   * Optional filename stem to write the SVG to under `assets/`.
   * Omit to get the inline `content` back without touching disk.
   */
  filename?: string;
  /** viewBox to ask the model to target. Default "0 0 100 100". */
  viewBox?: string;
  /** Color hint: "currentColor" (default), or any explicit color. */
  color?: string;
}

export type GenerateSvgError =
  | { kind: "MissingApiKey"; hint: string }
  | { kind: "EmptyPrompt" }
  | { kind: "LlmFailed"; message: string }
  | { kind: "ParseFailed"; message: string; raw: string }
  | { kind: "WriteFailed"; message: string };

export interface GenerateSvgResult {
  /** Inline content suitable for `<SVG content="…">`. */
  content: string;
  /** viewBox echoed back so the caller can wire it to the SVG helper. */
  viewBox: string;
  /** Where it was saved if `filename` was given; null otherwise. */
  assetPath: string | null;
  /** Tokens consumed (best-effort; null if the API didn't report). */
  tokensUsed: number | null;
}

const SYSTEM_PROMPT = [
  "You are an SVG illustration generator. The user gives a short visual",
  "description; you return only the inner SVG markup that goes INSIDE the",
  "outer <svg> tag. NO <svg> wrapper, NO <?xml>, NO markdown fences.",
  "",
  "Rules:",
  "- Target the given viewBox; assume coordinates 0..viewBox values.",
  '- Use `fill="currentColor"` so the parent can theme it (unless the prompt',
  "  asks for specific colors).",
  "- Prefer <path>, <circle>, <rect>, <polygon>, <line>; no gradients unless",
  "  the prompt specifies. No <script>, <foreignObject>, or interactivity.",
  "- Keep total node count under 50. No animations.",
  "- Indent 2 spaces.",
].join("\n");

function userPrompt(prompt: string, viewBox: string, color: string): string {
  return [
    `Prompt: ${prompt}`,
    `viewBox: ${viewBox}`,
    `color: ${color}`,
    "",
    "Return only SVG body markup (no <svg> wrapper).",
  ].join("\n");
}

/**
 * Strip common LLM artifacts the model adds despite instructions:
 * markdown fences, leading <svg> wrappers, comments-only output, etc.
 */
function cleanupSvgBody(text: string): string {
  let out = text.trim();
  // Strip ```svg ... ``` fences.
  out = out
    .replace(/^```(?:svg|xml|html)?\n?/i, "")
    .replace(/\n?```$/, "")
    .trim();
  // If the model included a full <svg>...</svg>, peel it.
  const wrapMatch = out.match(/<svg\b[^>]*>([\s\S]*)<\/svg>\s*$/i);
  if (wrapMatch?.[1]) out = wrapMatch[1].trim();
  // Strip <?xml ...?>.
  out = out.replace(/<\?xml[^?]*\?>/g, "").trim();
  return out;
}

function looksLikeSvgMarkup(body: string): boolean {
  if (body.length === 0) return false;
  // At least one element tag and no obvious script/event-handler escape hatches.
  if (!/<(path|circle|rect|polygon|line|polyline|ellipse|g|text|use)\b/i.test(body)) {
    return false;
  }
  if (/<script\b/i.test(body) || /on\w+=\s*["']/i.test(body)) return false;
  return true;
}

export async function generateSvg(
  folder: DesignFolder,
  prompt: string,
  opts: GenerateSvgOptions = {},
): Promise<Result<GenerateSvgResult, GenerateSvgError>> {
  const trimmed = prompt.trim();
  if (!trimmed) return err({ kind: "EmptyPrompt" });

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return err({
      kind: "MissingApiKey",
      hint: "Set ANTHROPIC_API_KEY to enable generate_svg. The tool calls Claude Haiku and writes the result inline (or to assets/ when `filename` is set).",
    });
  }

  const viewBox = opts.viewBox ?? "0 0 100 100";
  const color = opts.color ?? "currentColor";

  let res: Response;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: HAIKU_MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userPrompt(trimmed, viewBox, color) }],
      }),
    });
  } catch (e) {
    return err({ kind: "LlmFailed", message: (e as Error).message });
  }
  if (!res.ok) {
    return err({ kind: "LlmFailed", message: `Anthropic ${res.status} ${res.statusText}` });
  }

  let raw: string;
  let tokensUsed: number | null = null;
  try {
    const body = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    raw = body.content?.find((c) => c.type === "text")?.text ?? "";
    if (body.usage) {
      tokensUsed = (body.usage.input_tokens ?? 0) + (body.usage.output_tokens ?? 0);
    }
  } catch (e) {
    return err({ kind: "LlmFailed", message: `parse response: ${(e as Error).message}` });
  }

  const cleaned = cleanupSvgBody(raw);
  if (!looksLikeSvgMarkup(cleaned)) {
    return err({
      kind: "ParseFailed",
      message: "Model output did not contain recognizable SVG element markup.",
      raw,
    });
  }

  let assetPath: string | null = null;
  if (opts.filename) {
    // Strip the basename only — kill any path-separator segments AND
    // collapse `..` so a malicious caller can't climb out of assets/.
    const base = opts.filename.split(/[/\\]/).pop() ?? "asset";
    const safe =
      base
        .replace(/\.\./g, "_")
        .replace(/[^a-zA-Z0-9._-]/g, "_")
        .replace(/^[._-]+/, "")
        .replace(/_+/g, "_") || "asset";
    const rel = `assets/${safe.endsWith(".svg") ? safe : `${safe}.svg`}`;
    const abs = join(folder.root, rel);
    const fullSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" fill="${color}">\n${cleaned}\n</svg>\n`;
    try {
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, fullSvg, "utf8");
      assetPath = rel;
    } catch (e) {
      return err({ kind: "WriteFailed", message: (e as Error).message });
    }
  }

  return ok({ content: cleaned, viewBox, assetPath, tokensUsed });
}
