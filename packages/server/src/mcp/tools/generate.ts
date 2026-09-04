import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { CloudAuth } from "../../cloud.ts";
import { ASPECTS, describeGenerateFailure, generateAsset, INTENTS } from "../../cloud-generate.ts";
import type { MutationContext } from "../../mutations/index.ts";
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
          .max(2000)
          .describe(
            "What to generate, in plain language. Describe subject, style, lighting and mood — these models reward detail.",
          ),
        intent: z.enum(INTENTS).describe("What the artwork is for; picks the model. See above."),
        aspect: z
          .enum(ASPECTS)
          .optional()
          .describe(
            'Shape of the output. Defaults per intent ("16:9" for photo/graphic/texture, "1:1" for illustration/icon/vector). Ignored by edit/cutout/upscale, which follow the source.',
          ),
        count: z
          .number()
          .int()
          .min(1)
          .max(4)
          .optional()
          .describe(
            "Variants to generate in one call (default 1, max 4). EACH ONE IS CHARGED. Use 2-4 to give the user a choice on a hero asset; use 1 while iterating on a prompt.",
          ),
        reference: z
          .array(z.string())
          .max(3)
          .optional()
          .describe(
            'Existing assets to work from, as folder paths ("assets/hero.png"). REQUIRED by edit/cutout/upscale. Optional for photo/illustration/graphic, where it guides style or subject — e.g. "a stylized version of this landscape".',
          ),
        filename: z
          .string()
          .optional()
          .describe(
            "Stem for assets/<filename>.<png|svg>; default: the generation id. With count > 1 the variants become <filename>-1, <filename>-2, …",
          ),
      },
    },
    async ({ prompt, intent, aspect, count, reference, filename }) => {
      const r = await generateAsset(ctx.folder.root, cloud, {
        prompt,
        intent,
        aspect,
        count,
        reference,
        filename,
      });
      if (!r.ok) return errorResult(`generate_asset: ${describeGenerateFailure(r.error)}`);
      return jsonResult(r.value);
    },
  );
}
