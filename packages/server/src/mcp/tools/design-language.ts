import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readDesignRules, writeDesignRules } from "../../design-rules.ts";
import type { MutationContext } from "../../mutations/index.ts";
import { jsonResult, toMcp } from "./result.ts";

/**
 * The half of a design language the theme tools cannot carry: its rules in
 * words. An agent proposes them; the canvas is where a person reviews and
 * changes them, on a specimen of the design's own components.
 */
export function registerDesignLanguageTools(
  mcp: McpServer,
  ctx: MutationContext,
  canvasUrl?: string,
): void {
  mcp.registerTool(
    "set_design_language",
    {
      description:
        "State the design's rules in words — the last step of proposing a design language, after `import_theme` / `set_theme`. Saved to the design's own `guidance.md` (refused when it follows the repo's DESIGN.md, which is never written). The canvas shows them beside a specimen of the theme on real components, where the user reviews and edits; the saved file then outranks the generic defaults. Guide: velloo://guide/theme.",
      inputSchema: {
        intent: z
          .string()
          .optional()
          .describe("What the design is going for, one or two sentences. Omit to keep."),
        rules: z
          .array(
            z.object({
              kind: z.enum(["do", "dont"]),
              text: z.string().min(1).describe("The rule without a Do/Don't label"),
            }),
          )
          .optional()
          .describe("The complete list — it replaces the saved one. Omit to keep."),
      },
    },
    async (args) => {
      const current = await readDesignRules(ctx.folder);
      const written = await writeDesignRules(ctx, {
        intent: args.intent ?? current.intent,
        rules: args.rules ?? current.rules,
      });
      if (!written.ok) return toMcp(written);
      // A proposal nobody is sent to look at is just a file: say where it is shown.
      return jsonResult({
        ...written.value,
        review: `Proposed, not agreed: ask the user to review it on the canvas, under Design language${canvasUrl ? ` (${canvasUrl}/?view=language)` : ""} — they can edit the rules and the theme there, or cancel.`,
      });
    },
  );
}
