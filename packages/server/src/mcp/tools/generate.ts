import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { generateImage } from "../../generate/generate-image.ts";
import { generateSvg } from "../../generate/generate-svg.ts";
import type { MutationContext } from "../../mutations/index.ts";

type McpResult = {
  content: { type: "text"; text: string }[];
  isError?: true;
};

function ok(value: unknown): McpResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}
function fail(value: unknown): McpResult {
  return { isError: true, content: [{ type: "text", text: JSON.stringify(value) }] };
}

/**
 * Register the AI-asset generators. `generate_svg` calls Claude Haiku
 * for inline SVG markup; `generate_image` returns a Picsum placeholder
 * URL seeded by the prompt. For intentional, owned imagery the agent
 * authors the artwork itself and stores it with `upload_asset`.
 *
 * Both tools return shapes the agent can drop straight into a tree
 * via `add_node` — `<SVG content="…">` for SVG, `<Image src="…">`
 * for images.
 */
export function registerGenerateTools(mcp: McpServer, ctx: MutationContext): void {
  mcp.registerTool(
    "generate_svg",
    {
      description:
        "Generate an SVG illustration via Claude. Pass a natural-language prompt (e.g. 'a stylized cloud', 'a hand-drawn arrow', 'a geometric crystal'). Returns inline SVG markup ready to use as `<SVG content=\"…\" viewBox=\"…\" />`. Set `filename` to also persist it under `assets/`. Requires ANTHROPIC_API_KEY.",
      inputSchema: {
        prompt: z.string().min(1),
        filename: z
          .string()
          .optional()
          .describe("Stem for `assets/<filename>.svg`. Omit to keep the SVG inline."),
        viewBox: z.string().optional().describe('Target SVG viewBox; default "0 0 100 100".'),
        color: z
          .string()
          .optional()
          .describe('Fill color hint; default "currentColor" so the SVG theme-flips.'),
      },
    },
    async ({ prompt, filename, viewBox, color }) => {
      const r = await generateSvg(ctx.folder, prompt, { filename, viewBox, color });
      if (!r.ok) return fail(r.error);
      const helperNode = {
        $ref: "SVG",
        props: {
          content: r.value.content,
          viewBox: r.value.viewBox,
          ...(color ? { color } : {}),
        },
      };
      return ok({
        ...r.value,
        // Convenience: a complete `$ref:"SVG"` node the agent can
        // pass straight to `add_node` (via `children: [<this>]`).
        node: helperNode,
      });
    },
  );

  mcp.registerTool(
    "generate_image",
    {
      description:
        "Get a stable photo placeholder: Claude suggests alt text, the URL is a Picsum placeholder seeded by the prompt hash (same prompt → same image). Good for quick scaffolding; for intentional imagery author SVG/raster art yourself and store it with upload_asset instead. Returns shape for `<Image src=…>`.",
      inputSchema: {
        prompt: z.string().min(1),
        aspect: z
          .enum(["1:1", "4:3", "3:4", "16:9", "21:9"])
          .optional()
          .describe('Aspect ratio. Default "16:9".'),
        width: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Pixel width hint for the URL/render."),
      },
    },
    async ({ prompt, aspect, width }) => {
      const r = await generateImage(ctx.folder, prompt, { aspect, width });
      if (!r.ok) return fail(r.error);
      const helperNode = {
        $ref: "Image",
        props: {
          src: r.value.src,
          alt: r.value.alt,
          aspect: r.value.aspect,
          fill: true,
        },
      };
      return ok({ ...r.value, node: helperNode });
    },
  );
}
