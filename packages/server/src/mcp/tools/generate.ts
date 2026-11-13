import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { CloudAuth } from "../../cloud.ts";
import { describeGenerateFailure, generateAsset } from "../../cloud-generate.ts";
import type { MutationContext } from "../../mutations/index.ts";
import { imageryStyle, withImageryStyle } from "../../theme/imagery.ts";
import { errorResult, jsonResult } from "./result.ts";

/**
 * `generate_asset` — hosted, credit-metered image/SVG generation via
 * velloo-cloud. The offline-first stance holds: this is the ONE
 * deliberate paid path, registered unconditionally like `pull_comments` —
 * logged-out / feature-off / out-of-credits return clear agent-facing
 * messages instead of failing, and the local alternative (author the art,
 * `upload_asset`) is always named.
 *
 * The caller names an INTENT, never a model. The cloud owns intent → model, so
 * this description is the agent's whole catalogue: keep the glossary here in
 * step with the cloud's `intentSummaries()`.
 */
export function registerGenerateTools(
  mcp: McpServer,
  ctx: MutationContext,
  cloud: CloudAuth,
): void {
  mcp.registerTool(
    "generate_asset",
    {
      description:
        "Generate image assets from a prompt into assets/. **PAY-AS-YOU-GO against the user's credit balance** — author it yourself with `upload_asset` when you can, check `list_assets` first, iterate at `count: 1`, and ALWAYS relay the returned cost and remaining balance to the user. `intent` picks the model; `reference` restyles or edits an existing asset. Guide: velloo://guide/art.",
      inputSchema: {
        prompt: z
          .string()
          .min(1)
          .describe("Subject, style, lighting and mood: these models reward detail"),
        intent: z
          .string()
          .describe(
            "What the artwork is for; picks the model: photo, illustration (textures too), graphic, icon, vector, mark, edit, cutout, upscale; vector-fine and upscale-fine are finer and dearer, once the user has bought credits. An unknown one is refused with the list.",
          ),
        aspect: z
          .string()
          .optional()
          .describe(
            'Default per intent ("16:9" photo/graphic, "1:1" illustration/icon/vector); edit/cutout/upscale follow the source',
          ),
        count: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe(
            "Variants, EACH ONE CHARGED (default 1, at most 4): 2-4 for a choice on a hero asset, 1 while iterating",
          ),
        reference: z
          .array(z.string())
          .optional()
          .describe(
            'Folder paths of assets to work from ("assets/hero.png"); required by edit/cutout/upscale',
          ),
        filename: z
          .string()
          .optional()
          .describe("Stem for assets/<filename>.<png|svg>; variants add -1, -2…"),
        boardId: z
          .string()
          .optional()
          .describe("Its board, whose Look's imagery a photo, illustration or graphic follows"),
      },
    },
    async ({ prompt, intent, aspect, count, reference, filename, boardId }) => {
      const styled = withImageryStyle(
        { prompt, intent, aspect, count, reference, filename },
        imageryStyle(ctx, boardId),
      );
      const r = await generateAsset(ctx.folder.root, cloud, styled.req);
      if (!r.ok) return errorResult(`generate_asset: ${describeGenerateFailure(r.error)}`);
      return jsonResult(styled.said ? { ...r.value, imagery: styled.said } : r.value);
    },
  );
}
