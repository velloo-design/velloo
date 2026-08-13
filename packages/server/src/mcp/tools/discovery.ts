import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type ComponentDescriptor, loadManifest, snapshotVersion } from "@velloo/shadcn-snapshot";
import { z } from "zod";
import type { MutationContext } from "../../mutations/index.ts";

function jsonResult(value: unknown): { content: { type: "text"; text: string }[] } {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

interface ComponentSummary {
  id: string;
  category: ComponentDescriptor["category"];
  source: ComponentDescriptor["source"];
  /** Comma-separated list of prop names for quick scan. */
  props: string[];
  designModeNotes?: string;
}

function toSummary(c: ComponentDescriptor): ComponentSummary {
  const out: ComponentSummary = {
    id: c.id,
    category: c.category,
    source: c.source,
    props: c.props.map((p) => p.name),
  };
  if (c.designModeNotes) out.designModeNotes = c.designModeNotes;
  return out;
}

export function registerDiscoveryTools(mcp: McpServer, ctx: MutationContext): void {
  mcp.registerTool(
    "list_pages",
    {
      description: "List every page in the design folder with its variants.",
      inputSchema: {},
    },
    async () => {
      const pages = [...ctx.folder.pages.entries()].map(([id, page]) => ({
        id,
        name: page.name,
        variants: page.variants.map((v) => ({
          id: v.id,
          name: v.name,
          viewport: v.viewport,
        })),
      }));
      return jsonResult({ snapshotVersion, pages });
    },
  );

  mcp.registerTool(
    "get_page",
    {
      description: "Return the full JSON for a single page (all variants, full tree).",
      inputSchema: { pageId: z.string() },
    },
    async ({ pageId }) => {
      const page = ctx.folder.pages.get(pageId);
      if (!page) {
        return {
          isError: true,
          content: [{ type: "text", text: `Page not found: ${pageId}` }],
        };
      }
      return jsonResult(page);
    },
  );

  mcp.registerTool(
    "get_variant",
    {
      description: "Return a single variant's tree.",
      inputSchema: { pageId: z.string(), variantId: z.string() },
    },
    async ({ pageId, variantId }) => {
      const page = ctx.folder.pages.get(pageId);
      const variant = page?.variants.find((v) => v.id === variantId);
      if (!variant) {
        return {
          isError: true,
          content: [{ type: "text", text: `Variant not found: ${pageId}/${variantId}` }],
        };
      }
      return jsonResult(variant);
    },
  );

  mcp.registerTool(
    "list_components",
    {
      description:
        'List the bundled shadcn-snapshot components. Default `mode: "summary"` returns only id/category/source/prop-names — call with `mode: "full"` once you\'ve narrowed to the component(s) you need. `filter` substring-matches ids (case-insensitive).',
      inputSchema: {
        filter: z.string().optional(),
        mode: z.enum(["summary", "full"]).optional(),
      },
    },
    async ({ filter, mode }) => {
      const manifest = await loadManifest();
      const filtered = filter
        ? manifest.filter((c) => c.id.toLowerCase().includes(filter.toLowerCase()))
        : manifest;
      const out = (mode ?? "summary") === "full" ? filtered : filtered.map(toSummary);
      return jsonResult(out);
    },
  );

  mcp.registerTool(
    "get_theme",
    {
      description: "Return the active theme token tree.",
      inputSchema: {},
    },
    async () => jsonResult(ctx.folder.theme),
  );

  mcp.registerTool(
    "list_snippets",
    {
      description:
        "List every snippet defined in design/snippets/. Returns { id, name, params } per entry.",
      inputSchema: {},
    },
    async () => {
      const snippets = [...ctx.folder.snippets.entries()].map(([id, snippet]) => ({
        id,
        name: snippet.name,
        params: snippet.params,
      }));
      return jsonResult({ snippets });
    },
  );

  mcp.registerTool(
    "get_snippet",
    {
      description: "Return the full JSON for a single snippet (id, name, params, body tree).",
      inputSchema: { snippetId: z.string() },
    },
    async ({ snippetId }) => {
      const snippet = ctx.folder.snippets.get(snippetId);
      if (!snippet) {
        return {
          isError: true,
          content: [{ type: "text", text: `Snippet not found: ${snippetId}` }],
        };
      }
      return jsonResult(snippet);
    },
  );
}
