import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  isComponentNode,
  isParamRef,
  isSnippetInstance,
  type Node,
  nodeId,
  type Screen,
} from "@velloo/schema";
import {
  type ComponentDescriptor,
  loadManifest as loadBundledManifest,
  type Manifest,
  snapshotVersion,
} from "@velloo/shadcn-snapshot";
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
  props: string[];
  designModeNotes?: string;
}

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

function toOutline(screen: Screen): { id: string; name: string; tree: OutlineNode } {
  return { id: screen.id, name: screen.name, tree: nodeToOutline(screen.tree) };
}

/** Read the design folder's on-disk manifest, falling back to the bundled one. */
async function loadManifestForCtx(ctx: MutationContext): Promise<Manifest> {
  const onDisk = join(ctx.folder.root, ".design", "manifest.json");
  try {
    const raw = await readFile(onDisk, "utf8");
    return JSON.parse(raw) as Manifest;
  } catch {
    return loadBundledManifest();
  }
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
    "list_screens",
    {
      description:
        "List every screen in the design folder. Pass `include_tree: true` to embed each screen's full tree — one round-trip instead of list_screens + N get_screen calls. Default false to keep responses small.",
      inputSchema: { include_tree: z.boolean().optional() },
    },
    async ({ include_tree }) => {
      const screens = [...ctx.folder.screens.entries()].map(([id, screen]) => ({
        id,
        name: screen.name,
        ...(include_tree ? { tree: screen.tree } : {}),
      }));
      return jsonResult({ snapshotVersion, screens });
    },
  );

  mcp.registerTool(
    "get_screen",
    {
      description:
        'Return the JSON for a single screen. mode: "full" (default) returns the complete tree. mode: "outline" returns a stripped tree per node: {ref|snippet, $id?, classSnippet (≤40 chars), children}. Use outline for an overview of a large screen before drilling in with inspect or @id locators.',
      inputSchema: {
        screenId: z.string(),
        mode: z.enum(["full", "outline"]).optional(),
      },
    },
    async ({ screenId, mode }) => {
      const screen = ctx.folder.screens.get(screenId);
      if (!screen) {
        return {
          isError: true,
          content: [{ type: "text", text: `Screen not found: ${screenId}` }],
        };
      }
      if (mode === "outline") return jsonResult(toOutline(screen));
      return jsonResult(screen);
    },
  );

  mcp.registerTool(
    "list_boards",
    {
      description:
        "List every board in the design folder. Each board has its own collection of frames + groups. Pass `include_frames: true` to embed the full frame list for each board.",
      inputSchema: { include_frames: z.boolean().optional() },
    },
    async ({ include_frames }) => {
      const boards = [...ctx.folder.boards.entries()].map(([id, board]) => ({
        id,
        name: board.name,
        frameCount: board.frames.length,
        ...(include_frames ? { frames: board.frames, groups: board.groups } : {}),
      }));
      return jsonResult({ boards });
    },
  );

  mcp.registerTool(
    "get_board",
    {
      description:
        "Return one board's full JSON — frames (placements of screens at chosen sizes) and groups.",
      inputSchema: { boardId: z.string() },
    },
    async ({ boardId }) => {
      const board = ctx.folder.boards.get(boardId);
      if (!board) {
        return {
          isError: true,
          content: [{ type: "text", text: `Board not found: ${boardId}` }],
        };
      }
      return jsonResult(board);
    },
  );

  mcp.registerTool(
    "list_components",
    {
      description:
        'List the available components. Default `mode: "summary"` returns only id/category/source/prop-names — call with `mode: "full"` once you\'ve narrowed to the component(s) you need. `filter` substring-matches ids (case-insensitive).',
      inputSchema: {
        filter: z.string().optional(),
        mode: z.enum(["summary", "full"]).optional(),
      },
    },
    async ({ filter, mode }) => {
      const manifest = await loadManifestForCtx(ctx);
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
        "List designer-authored annotations on a screen. Each annotation is anchored to a specific node via a locator; `resolved` carries the resolved path (or null if the targeted node has since vanished — treat dangling annotations as low-priority). Read-only: agents can consume annotations as guidance but cannot create or edit them. The `body` field is markdown.",
      inputSchema: { screenId: z.string() },
    },
    async ({ screenId }) => {
      const screen = ctx.folder.screens.get(screenId);
      const annotations = ctx.folder.annotations.get(screenId) ?? [];
      const list = annotations.map((a) => {
        const resolved = screen ? resolveLocator(screen.tree, a.target.locator) : null;
        return { ...a, resolved };
      });
      return jsonResult({ annotations: list });
    },
  );

  mcp.registerTool(
    "list_notes",
    {
      description:
        "List free-positioned markdown notes on one board. Designer scratchpad — read-only from the agent's POV.",
      inputSchema: { boardId: z.string() },
    },
    async ({ boardId }) => {
      const notes = ctx.folder.notes.get(boardId) ?? [];
      return jsonResult({ notes });
    },
  );
}
