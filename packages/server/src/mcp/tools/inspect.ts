import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { inspect, type MutationContext } from "../../mutations/index.ts";

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
      const result = await inspect(ctx, args);
      if (result.ok) {
        return { content: [{ type: "text", text: JSON.stringify(result.value, null, 2) }] };
      }
      return {
        isError: true,
        content: [{ type: "text", text: JSON.stringify(result.error) }],
      };
    },
  );
}
