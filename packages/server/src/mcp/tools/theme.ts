import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  applyPreset,
  derivePaletteFromColor,
  matchImage,
  matchVibe,
  PRESET_NAMES,
  setToken,
  type ThemeContext,
  ThemeError,
} from "../../theme/index.ts";

function jsonResult(value: unknown): { content: { type: "text"; text: string }[] } {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function errorResult(err: unknown): {
  isError: true;
  content: { type: "text"; text: string }[];
} {
  if (err instanceof ThemeError) {
    return { isError: true, content: [{ type: "text", text: JSON.stringify(err.payload) }] };
  }
  return { isError: true, content: [{ type: "text", text: String(err) }] };
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
      try {
        const theme = await setToken(ctx, args.path, args.value);
        return jsonResult({ theme });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  mcp.registerTool(
    "apply_preset",
    {
      description: `Replace the active theme with a named preset. Known presets: ${PRESET_NAMES.join(", ")}.`,
      inputSchema: { presetName: z.string() },
    },
    async (args) => {
      try {
        const theme = await applyPreset(ctx, args.presetName);
        return jsonResult({ theme });
      } catch (err) {
        return errorResult(err);
      }
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
    async (args) => {
      try {
        const result = await derivePaletteFromColor(ctx, args.seedColor, args.name);
        return jsonResult(result);
      } catch (err) {
        return errorResult(err);
      }
    },
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
    async (args) => {
      try {
        const result = await matchVibe(ctx, args.description, { useAi: args.useAi });
        return jsonResult(result);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  mcp.registerTool(
    "match_image",
    {
      description:
        "Extract a palette from an image (Vibrant + Muted + Dark/Light variants) and apply a derived theme. imagePath is relative to the design folder's assets/ (or absolute).",
      inputSchema: { imagePath: z.string() },
    },
    async (args) => {
      try {
        const result = await matchImage(ctx, args.imagePath);
        return jsonResult(result);
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
