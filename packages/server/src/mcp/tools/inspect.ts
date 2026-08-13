import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  auditSnippet,
  darkModeAudit,
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
