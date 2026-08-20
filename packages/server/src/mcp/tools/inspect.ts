import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { themeByName } from "../../design-folder.ts";
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
        "Return SSR'd HTML, resolved className list, $ref, and resolved props for the node at path. Use this instead of guessing the rendered output. When path resolves to a snippet instance, pass innerPath to inspect a node *inside* the resolved body (args, $overrides, and $extraClassName applied) — omit it to inspect the body root.",
      inputSchema: {
        screenId: z.string(),
        path: Locator,
        innerPath: z
          .string()
          .optional()
          .describe(
            'For a snippet instance: a dotted index path like "0.2", an "@id" of a node in the body, or "" for the body root (the default). Ignored for plain components.',
          ),
      },
    },
    async (args) => {
      const result = await inspect(ctx, args);
      if (result.ok) {
        return { content: [{ type: "text", text: JSON.stringify(result.value) }] };
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
        return { content: [{ type: "text", text: JSON.stringify(result.value) }] };
      }
      return {
        isError: true,
        content: [{ type: "text", text: JSON.stringify(result.error) }],
      };
    },
  );

  mcp.registerTool(
    "audit",
    {
      description:
        "Dark-mode audit for a screen (screenId) or snippet body (snippetId) — exactly one. Flags color classes that won't theme-flip; structural utilities exempt; set data-accent on a node to exempt it. Returns coverage + per-node problems with token suggestions. Pass theme to evaluate against a named theme — when that theme declares no colorsDark block, the result says so and coverage is informational.",
      inputSchema: {
        screenId: z.string().optional(),
        snippetId: z.string().optional(),
        theme: z.string().optional().describe("Named theme context (boards pin one)"),
      },
    },
    async ({ screenId, snippetId, theme }) => {
      if ((screenId === undefined) === (snippetId === undefined)) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: JSON.stringify({
                kind: "BadRequest",
                message: "audit: pass exactly one of screenId or snippetId.",
              }),
            },
          ],
        };
      }
      const result =
        screenId !== undefined
          ? await darkModeAudit(ctx, { screenId })
          : await auditSnippet(ctx, { snippetId: snippetId as string });
      if (result.ok) {
        const resolved = themeByName(ctx.folder, theme);
        const hasDarkVariant = resolved.colorsDark !== undefined;
        const themeInfo = {
          theme: theme ?? "default",
          hasDarkVariant,
          ...(hasDarkVariant
            ? {}
            : {
                note: `theme "${theme ?? "default"}" declares no colorsDark block — semantic tokens render identically in both modes, so dark-mode coverage here is informational only`,
              }),
        };
        return {
          content: [{ type: "text", text: JSON.stringify({ ...result.value, themeInfo }) }],
        };
      }
      return {
        isError: true,
        content: [{ type: "text", text: JSON.stringify(result.error) }],
      };
    },
  );
}
