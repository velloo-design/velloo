import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  isComponentNode,
  isParamRef,
  isSnippetInstance,
  type Node,
  nodeId,
  type Page,
} from "@velloo/schema";
import { type ComponentDescriptor, loadManifest, snapshotVersion } from "@velloo/shadcn-snapshot";
import { z } from "zod";
import type { MutationContext } from "../../mutations/index.ts";
import { resolveLocator } from "../../path.ts";

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

/** Truncate a className string for outline display. */
function shortClass(cls: string, max = 40): string {
  const trimmed = cls.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

interface OutlineNode {
  ref?: string;
  snippet?: string;
  param?: string;
  $id?: string;
  classSnippet?: string;
  children?: OutlineNode[];
}

function nodeToOutline(node: Node): OutlineNode {
  if (isParamRef(node)) return { param: node.$param };
  if (isSnippetInstance(node)) {
    const out: OutlineNode = { snippet: node.$snippet };
    const id = nodeId(node);
    if (id) out.$id = id;
    return out;
  }
  if (!isComponentNode(node)) return {};
  const out: OutlineNode = { ref: node.$ref };
  const id = nodeId(node);
  if (id) out.$id = id;
  const cls = typeof node.props?.className === "string" ? (node.props.className as string) : "";
  if (cls) out.classSnippet = shortClass(cls);
  if (node.children && node.children.length > 0) {
    out.children = node.children.map(nodeToOutline);
  }
  return out;
}

function toOutline(page: Page): {
  name: string;
  variants: Array<{ id: string; name: string; viewport: unknown; tree: OutlineNode }>;
} {
  return {
    name: page.name,
    variants: page.variants.map((v) => ({
      id: v.id,
      name: v.name,
      viewport: v.viewport,
      tree: nodeToOutline(v.tree),
    })),
  };
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
      description:
        "List every page in the design folder with its variants. Pass `include_tree: true` to also embed each variant's full tree — one round-trip instead of list_pages + N get_page calls. Default false to keep responses small.",
      inputSchema: { include_tree: z.boolean().optional() },
    },
    async ({ include_tree }) => {
      const pages = [...ctx.folder.pages.entries()].map(([id, page]) => ({
        id,
        name: page.name,
        variants: page.variants.map((v) => ({
          id: v.id,
          name: v.name,
          viewport: v.viewport,
          ...(include_tree ? { tree: v.tree } : {}),
        })),
      }));
      return jsonResult({ snapshotVersion, pages });
    },
  );

  mcp.registerTool(
    "get_page",
    {
      description:
        'Return the JSON for a single page. mode: "full" (default) returns every variant and the complete tree — useful when you\'re about to do many edits on a small page. mode: "outline" returns a stripped tree per node: {ref|snippet, $id?, classSnippet (≤40 chars), children}. Use outline for an overview of a large page before drilling in with inspect or @id locators.',
      inputSchema: {
        pageId: z.string(),
        mode: z.enum(["full", "outline"]).optional(),
      },
    },
    async ({ pageId, mode }) => {
      const page = ctx.folder.pages.get(pageId);
      if (!page) {
        return {
          isError: true,
          content: [{ type: "text", text: `Page not found: ${pageId}` }],
        };
      }
      if (mode === "outline") return jsonResult(toOutline(page));
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

  mcp.registerTool(
    "list_annotations",
    {
      description:
        "List designer-authored annotations on a page. Each annotation is anchored to a specific node via a locator; `resolved` carries the resolved path (or null if the targeted node has since vanished — treat dangling annotations as low-priority). Read-only: agents can consume annotations as guidance but cannot create or edit them. The `body` field is markdown.",
      inputSchema: { pageId: z.string() },
    },
    async ({ pageId }) => {
      const page = ctx.folder.pages.get(pageId);
      const annotations = ctx.folder.annotations.get(pageId) ?? [];
      // Resolve locators against the current variant trees so agents know
      // which annotations point at currently-existing nodes.
      const list = annotations.map((a) => {
        let resolved: number[] | null = null;
        if (page) {
          const variant = page.variants.find((v) => v.id === a.target.variantId);
          if (variant) resolved = resolveLocator(variant.tree, a.target.locator);
        }
        return { ...a, resolved };
      });
      return jsonResult({ annotations: list });
    },
  );
}
