import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  auditSnippet,
  darkModeAudit,
  inspect,
  type MutationContext,
} from "../../mutations/index.ts";

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
        "Audit a variant for dark-mode awareness. Flags every color-bearing class that won't theme-flip (bg-zinc-*, text-emerald-*, bg-[#hex], white/black literals). Structural utilities (border-b, ring-0, shadow-none, text-xl, bg-transparent, text-current) are exempt by design. Set `data-accent` (any truthy value) on a node's props to exempt it entirely — use for intentional non-flipping accents (brand mark, hero gradient, status pills with explicit dark: variants). Returns coverage (0..1) + per-node problems with semantic-token suggestions. Treat the score as a triage signal, not a gate.",
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

  mcp.registerTool(
    "inspect_dark_diff_snippet",
    {
      description:
        "Run the dark-mode audit against a snippet body. Catches bad raw-color patterns at definition time rather than at N instantiation sites. Same scoring + data-accent opt-out as `inspect_dark_diff`; paths are relative to the snippet body's root. Run right after `add_snippet` or `update_snippet`.",
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
