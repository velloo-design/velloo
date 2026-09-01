import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { CloudAuth } from "../../cloud.ts";
import { ASPECTS, generateAsset, INTENTS } from "../../cloud-generate.ts";
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
        "Generate artwork from a text prompt via velloo-cloud (hosted, PAY-AS-YOU-GO against the user's credit balance; requires `velloo login`). " +
        "Stores each result in assets/ and returns its /assets/<name> URL for `<Image src>`, plus the pixel `width`/`height` — `<Image>` FILLS ITS PARENT, so pass a matching `aspect` (or put it in a sized box) or it renders at zero height. " +
        "SVG intents also return inline markup for `<SVG content>`. " +
        "Pick the intent by what the artwork is FOR — the server chooses the model: " +
        "`photo` realistic marketing/product/hero photography · " +
        "`illustration` stylized spot art, empty states, editorial · " +
        "`graphic` layouts needing LEGIBLE TEXT (banners, posters, OG images) · " +
        "`texture` abstract backgrounds, gradients, patterns · " +
        "`icon` one UI pictogram, transparent background (raster) · " +
        "`vector` true SVG out — illustrative logos and spot vectors · " +
        "`mark` geometric flat SVG (simple logos, arrows, shapes) — precise and the cheapest SVG · " +
        "`edit` a surgical change to an existing asset · " +
        "`cutout` remove an asset's background · " +
        "`upscale` enlarge an asset. " +
        "Prices differ per intent and the result reports the exact cost and remaining balance — RELAY BOTH TO THE USER. " +
        "For artwork you can author yourself (flat shapes, gradients, simple marks), prefer `upload_asset` — free and offline.",
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
      if (!r.ok) return errorResult(`generate_asset: ${r.error.message}`);
      return jsonResult(r.value);
    },
  );
}
