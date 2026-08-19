import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
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
 * for inline SVG markup. For intentional, owned imagery the agent
 * authors the artwork itself and stores it with `upload_asset`.
 *
 * Returns a shape the agent can drop straight into a tree via
 * `add_node` — `<SVG content="…">`.
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
}
