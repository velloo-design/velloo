import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { CloudAuth } from "../../cloud.ts";
import { generateAsset, IMAGE_SIZES } from "../../cloud-generate.ts";
import type { MutationContext } from "../../mutations/index.ts";

/**
 * `generate_asset` — hosted, credit-metered image/SVG generation via
 * velloo-cloud. The offline-first stance holds: this is the ONE
 * deliberate paid path, registered unconditionally like `pull_comments` —
 * logged-out / feature-off / out-of-credits return clear agent-facing
 * messages instead of failing, and the local alternative (author the art,
 * `upload_asset`) is always named.
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
        'Generate an image or SVG from a text prompt via velloo-cloud (hosted, credit-metered; requires `velloo login`). Stores the result in assets/ and returns its /assets/<name> URL for `<Image src>`; kind: "svg" also returns the inline markup for `<SVG content>`. The result reports the credit cost and remaining balance — relay it to the user. For artwork you can author yourself, prefer `upload_asset` (free, offline).',
      inputSchema: {
        prompt: z.string().min(1).max(2000).describe("What to generate, in plain language."),
        kind: z.enum(["image", "svg"]),
        size: z.enum(IMAGE_SIZES).optional().describe('Image only; default "1024x1024".'),
        filename: z
          .string()
          .optional()
          .describe("Stem for assets/<filename>.<png|svg>; default: the generation id."),
      },
    },
    async ({ prompt, kind, size, filename }) => {
      const r = await generateAsset(ctx.folder.root, cloud, { prompt, kind, size, filename });
      if (!r.ok) {
        return {
          isError: true as const,
          content: [{ type: "text" as const, text: `generate_asset: ${r.error.message}` }],
        };
      }
      return { content: [{ type: "text" as const, text: JSON.stringify(r.value) }] };
    },
  );
}
