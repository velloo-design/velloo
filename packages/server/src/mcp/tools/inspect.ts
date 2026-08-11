import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { inspect, type MutationContext, MutationError } from "../../mutations/index.ts";

const PathSchema = z.array(z.number().int().nonnegative());

export function registerInspectTool(mcp: McpServer, ctx: MutationContext): void {
  mcp.registerTool(
    "inspect",
    {
      description:
        "Return SSR'd HTML, resolved className list, $ref, and resolved props for the node at path. Use this instead of guessing the rendered output.",
      inputSchema: {
        pageId: z.string(),
        variantId: z.string(),
        path: PathSchema,
      },
    },
    async (args) => {
      try {
        const r = await inspect(ctx, args);
        return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
      } catch (err) {
        if (err instanceof MutationError) {
          return {
            isError: true,
            content: [{ type: "text", text: JSON.stringify(err.payload) }],
          };
        }
        return { isError: true, content: [{ type: "text", text: String(err) }] };
      }
    },
  );
}
