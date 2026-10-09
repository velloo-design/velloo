import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { $, DoAsync } from "@velloo/result";
import { z } from "zod";
import { readDesignRules, writeDesignRules } from "../../design-rules.ts";
import type { MutationContext, MutationError } from "../../mutations/index.ts";
import { ensureSpecimen, type SpecimenResult } from "../../specimen.ts";
import { toMcp } from "./result.ts";

/**
 * The half of a design language the theme tools cannot carry: its rules in
 * words, and the board that shows the whole of it on real components. An agent
 * proposes both; the canvas is where a person reviews and changes them.
 */
export function registerDesignLanguageTools(mcp: McpServer, ctx: MutationContext): void {
  mcp.registerTool(
    "set_design_language",
    {
      description:
        "State the design's rules in words and put its specimen board on the canvas — the last step of proposing a design language, after `import_theme` / `set_theme`. `intent` and `rules` are saved to the design's own `guidance.md` (refused when it follows the repo's DESIGN.md, which is never written). `specimen` builds the Design language board: colour roles, the type ladder, the corner scale and real library components, light and dark. Guide: velloo://guide/theme.",
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
        specimen: z
          .enum(["build", "rebuild"])
          .optional()
          .describe("`build` leaves an existing specimen alone; `rebuild` regenerates its screen"),
      },
    },
    async (args) =>
      toMcp(
        await DoAsync<object, MutationError>(async function* () {
          let rules = await readDesignRules(ctx.folder);
          if (args.intent !== undefined || args.rules !== undefined) {
            rules = yield* $(
              await writeDesignRules(ctx, {
                intent: args.intent ?? rules.intent,
                rules: args.rules ?? rules.rules,
              }),
            );
          }
          let specimen: SpecimenResult | undefined;
          if (args.specimen) {
            specimen = yield* $(
              await ensureSpecimen(ctx, { rebuild: args.specimen === "rebuild" }),
            );
          }
          return { ...rules, ...(specimen ? { specimen } : {}) };
        }),
      ),
  );
}
