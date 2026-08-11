import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadManifest, snapshotVersion } from "@velloo/shadcn-snapshot";
import { z } from "zod";
import type { MutationContext } from "../../mutations/index.ts";

function jsonResult(value: unknown): { content: { type: "text"; text: string }[] } {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
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
        "List the bundled shadcn-snapshot components with their prop schemas. Pass `filter` to substring-match against ids.",
      inputSchema: { filter: z.string().optional() },
    },
    async ({ filter }) => {
      const manifest = await loadManifest();
      const filtered = filter
        ? manifest.filter((c) => c.id.toLowerCase().includes(filter.toLowerCase()))
        : manifest;
      return jsonResult(filtered);
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
}
