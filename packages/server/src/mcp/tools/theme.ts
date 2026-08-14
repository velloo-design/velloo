import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Result } from "@velloo/result";
import { z } from "zod";
import type { ThemeError } from "../../theme/errors.ts";
import {
  applyPreset,
  derivePaletteFromColor,
  matchImage,
  matchVibe,
  PRESET_NAMES,
  scoreThemeContrast,
  setToken,
  type ThemeContext,
} from "../../theme/index.ts";

type McpResult = {
  content: { type: "text"; text: string }[];
  isError?: true;
};

function jsonResult(value: unknown): McpResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function themeErrorResult(error: ThemeError): McpResult {
  return { isError: true, content: [{ type: "text", text: JSON.stringify(error) }] };
}

function toMcp<T>(result: Result<T, ThemeError>): McpResult {
  return result.ok ? jsonResult(result.value) : themeErrorResult(result.error);
}

export function registerThemeTools(mcp: McpServer, ctx: ThemeContext): void {
  mcp.registerTool(
    "set_token",
    {
      description:
        'Set a single theme token at a dot-path (e.g. "colors.primary.DEFAULT"). The full theme is schema-validated after the patch.',
      inputSchema: {
        path: z.string(),
        value: z.union([z.string(), z.number()]),
      },
    },
    async (args) => {
      const r = await setToken(ctx, args.path, args.value);
      return toMcp(r.ok ? { ok: true, value: { theme: r.value } } : r);
    },
  );

  mcp.registerTool(
    "apply_preset",
    {
      description: `Replace the active theme with a named preset. Known presets: ${PRESET_NAMES.join(", ")}.`,
      inputSchema: { presetName: z.string() },
    },
    async (args) => {
      const r = await applyPreset(ctx, args.presetName);
      return toMcp(r.ok ? { ok: true, value: { theme: r.value } } : r);
    },
  );

  mcp.registerTool(
    "derive_palette_from_color",
    {
      description:
        "Generate a full OKLCH-based color palette from a seed color (#hex, oklch(), rgb(), etc.) and apply it as the new theme. Foreground/background contrast is auto-adjusted to WCAG AA.",
      inputSchema: {
        seedColor: z.string(),
        name: z.string().optional(),
      },
    },
    async (args) => toMcp(await derivePaletteFromColor(ctx, args.seedColor, args.name)),
  );

  mcp.registerTool(
    "match_vibe",
    {
      description:
        "Map a vibe description (e.g. 'playful', 'corporate', 'forest') to a seed color via a curated table, then derive and apply a palette. Pass useAi=true to ask Claude Haiku for a seed color when ANTHROPIC_API_KEY is configured — this may call an external LLM.",
      inputSchema: {
        description: z.string(),
        useAi: z.boolean().optional(),
      },
    },
    async (args) => toMcp(await matchVibe(ctx, args.description, { useAi: args.useAi })),
  );

  mcp.registerTool(
    "match_image",
    {
      description:
        "Extract a palette from an image (Vibrant + Muted + Dark/Light variants) and apply a derived theme. imagePath is relative to the design folder's assets/ (or absolute).",
      inputSchema: { imagePath: z.string() },
    },
    async (args) => toMcp(await matchImage(ctx, args.imagePath)),
  );

  mcp.registerTool(
    "score_theme_contrast",
    {
      description:
        "Score WCAG contrast ratios for the active theme's salient color pairs (foreground/background, primary/primary-foreground, …). Returns ratio + tier (AAA / AA / AAlarge / Fail). Use after a derive/preset/match-vibe to confirm accessibility before shipping.",
      inputSchema: {},
    },
    async () => {
      const results = scoreThemeContrast(ctx.folder.theme);
      const fails = results.filter((r) => r.tier === "Fail").length;
      const passes = results.length - fails;
      return jsonResult({ summary: { total: results.length, passes, fails }, results });
    },
  );
}
