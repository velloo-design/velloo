import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { darkModeAudit, inspect, type MutationContext } from "../../mutations/index.ts";

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

  mcp.registerTool(
    "inspect_dark_diff",
    {
      description:
        "Audit a variant for dark-mode awareness. Walks the tree and flags every node whose className uses raw Tailwind palette colors (bg-zinc-900, text-emerald-400, etc.) or hardcoded white/black — these render IDENTICALLY in light and dark mode, defeating the dark-mode theme. Returns a coverage score (0..1) plus per-node problem list with suggested semantic-token replacements (bg-card, text-foreground, etc.) where an obvious one exists. Run before claiming a page is dark-mode-ready.",
      inputSchema: {
        pageId: z.string(),
        variantId: z.string(),
      },
    },
    async (args) => {
      const result = await darkModeAudit(ctx, args);
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
