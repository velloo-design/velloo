import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  auditSnippet,
  darkModeAudit,
  findNodes,
  inspect,
  type MutationContext,
} from "../../mutations/index.ts";

const Locator = z.union([z.array(z.number().int().nonnegative()), z.string()]);

export function registerInspectTool(mcp: McpServer, ctx: MutationContext): void {
  mcp.registerTool(
    "inspect",
    {
      description:
        "Return SSR'd HTML, resolved className list, $ref, and resolved props for the node at path. Use this instead of guessing the rendered output.",
      inputSchema: {
        screenId: z.string(),
        path: Locator,
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
    "find_nodes",
    {
      description:
        'Query a screen tree for nodes matching filters (ANDed): exact $ref, exact $snippet, exact $id, className substring, or prop presence/value. Returns paths + ids + summaries — use this to locate targets for update_props/move_node instead of fetching and walking the whole tree. Example: { screenId: "home", ref: "Icon", prop: "name", propValue: "Github" }.',
      inputSchema: {
        screenId: z.string(),
        ref: z.string().optional().describe("Exact component $ref, e.g. 'Button'"),
        snippetId: z.string().optional().describe("Exact $snippet id for snippet instances"),
        id: z.string().optional().describe("Exact $id anchor"),
        classContains: z.string().optional().describe("Substring of props.className"),
        prop: z.string().optional().describe("Prop key that must be present"),
        propValue: z.unknown().optional().describe("With prop: strict-equal value match"),
        limit: z.number().int().positive().optional().describe("Max matches; default 50"),
      },
    },
    async (args) => {
      const result = await findNodes(ctx, args);
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
        "Audit a screen for dark-mode awareness. Flags every color-bearing class that won't theme-flip. Structural utilities (border-b, ring-0, shadow-none, text-xl, bg-transparent, text-current) are exempt by design. Set `data-accent` (any truthy value) on a node's props to exempt it entirely. Returns coverage (0..1) + per-node problems with semantic-token suggestions.",
      inputSchema: {
        screenId: z.string(),
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

  mcp.registerTool(
    "inspect_dark_diff_snippet",
    {
      description:
        "Run the dark-mode audit against a snippet body. Catches bad raw-color patterns at definition time rather than at N instantiation sites.",
      inputSchema: {
        snippetId: z.string(),
      },
    },
    async (args) => {
      const result = await auditSnippet(ctx, args);
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
