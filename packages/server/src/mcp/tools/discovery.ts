import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ComponentDescriptor, Manifest } from "@velloo/provider";
import {
  DEFAULT_TYPESET_NAME,
  isComponentNode,
  isParamRef,
  isSnippetInstance,
  type Node,
  nodeId,
  type Screen,
  typesetScale,
} from "@velloo/schema";
import { z } from "zod";
import {
  activeBoards,
  type DesignFolder,
  orderedBoards,
  resolveNamedTheme,
} from "../../design-folder.ts";
import { boardNotFound, screenNotFound, snippetNotFound } from "../../mutations/errors.ts";
import type { MutationContext } from "../../mutations/index.ts";
import { resolveLocator } from "../../path.ts";
import { errorResult, jsonResult } from "./result.ts";

/**
 * Snippets mark a param required by the *absence* of `default`/`optional`. Agents reliably
 * miss inferred-from-absence contracts, so surface it as an explicit `required` flag — this
 * is the pre-call visibility that prevents the SnippetParamMismatch first-try failure.
 */
function withRequiredFlag<T extends { default?: unknown; optional?: boolean | undefined }>(
  param: T,
): T & { required: boolean } {
  return { ...param, required: param.default === undefined && !param.optional };
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

/**
 * `full` mode returns whole descriptors, but a few props enumerate huge
 * value sets — `Icon.name` is ~4k lucide names (~68 KB), ~700× the rest of
 * the descriptor. Send a sample plus a remaining-count so the agent learns
 * the prop is free-form without paying for the whole list (the descriptor's
 * `example` shows a real value to copy).
 */
const MAX_ENUM_VALUES = 40;

function trimLargeEnums<T extends { props: { enumValues?: (string | number)[] | undefined }[] }>(
  entry: T,
): T {
  if (!entry.props.some((p) => p.enumValues && p.enumValues.length > MAX_ENUM_VALUES)) {
    return entry;
  }
  const props = entry.props.map((p) =>
    p.enumValues && p.enumValues.length > MAX_ENUM_VALUES
      ? {
          ...p,
          enumValues: p.enumValues.slice(0, MAX_ENUM_VALUES),
          enumValuesTruncated: p.enumValues.length - MAX_ENUM_VALUES,
        }
      : p,
  );
  return { ...entry, props };
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

/** Read the design folder's on-disk manifest, falling back to the active provider's. */
async function loadManifestForCtx(ctx: MutationContext): Promise<Manifest> {
  const onDisk = join(ctx.folder.root, ".design", "manifest.json");
  try {
    const raw = await readFile(onDisk, "utf8");
    return JSON.parse(raw) as Manifest;
  } catch {
    return ctx.defaultProvider.loadManifest();
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

/**
 * `list_boards`' payload, extracted so the selection rule is testable without
 * standing up an MCP session. Honors config.boardOrder so the agent sees the
 * same order as the canvas + /api/design (reorder_boards' effect would
 * otherwise be invisible here), and hides archived boards unless asked.
 */
export function listBoardsPayload(
  folder: DesignFolder,
  opts: { include_frames?: boolean | undefined; include_archived?: boolean | undefined } = {},
): Record<string, unknown>[] {
  const entries = opts.include_archived ? orderedBoards(folder) : activeBoards(folder);
  const groups = new Map((folder.config.boardGroups ?? []).map((g) => [g.id, g.name]));
  return entries.map(([id, board]) => ({
    id,
    name: board.name,
    frameCount: board.frames.length,
    ...(board.group ? { group: groups.get(board.group) ?? board.group } : {}),
    ...(board.archivedAt ? { archivedAt: board.archivedAt } : {}),
    ...(opts.include_frames ? { frames: board.frames, groups: board.groups } : {}),
  }));
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
      return jsonResult({ snapshotVersion: ctx.defaultProvider.version, screens });
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
      if (!screen) return errorResult(screenNotFound(screenId));
      if (mode === "outline") return jsonResult(toOutline(screen));
      return jsonResult(screen);
    },
  );

  mcp.registerTool(
    "list_boards",
    {
      description:
        "List the design folder's live boards, in sidebar order. Each board has its own collection of frames; `group` names the sidebar group it's filed under (absent ⇒ ungrouped) — pass that name to add_board/update_board to file another board alongside it. Pass `include_frames: true` to embed the full frame list for each board, or `include_archived: true` to also list boards the user has archived (those carry `archivedAt`).",
      inputSchema: {
        include_frames: z.boolean().optional(),
        include_archived: z.boolean().optional(),
      },
    },
    async ({ include_frames, include_archived }) =>
      jsonResult({ boards: listBoardsPayload(ctx.folder, { include_frames, include_archived }) }),
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
      if (!board) return errorResult(boardNotFound(boardId));
      return jsonResult(board);
    },
  );

  mcp.registerTool(
    "list_components",
    {
      description:
        'List the available components — library entries first, then registered extensions. Default `mode: "summary"` returns id/source/category/prop-names; `mode: "full"` returns the complete descriptors. `filter` substring-matches ids (case-insensitive). `kind: "library"` or `kind: "extension"` narrows the result; extensions are user-declared custom components (DataTable, BrandHero, …) that shadow library entries with the same id.',
      inputSchema: {
        filter: z.string().optional(),
        mode: z.enum(["summary", "full"]).optional(),
        kind: z.enum(["library", "extension"]).optional(),
      },
    },
    async ({ filter, mode, kind }) => {
      const manifest = await loadManifestForCtx(ctx);
      const libraryEntries = manifest.map((c) => ({ ...c, kind: "library" as const }));
      const extensions = ctx.folder.config.extensions ?? {};
      const extensionEntries = Object.entries(extensions).map(([id, ext]) => ({
        id,
        category: ext.category ?? "ui",
        source: "extension",
        props: ext.props,
        designModeNotes: ext.description,
        kind: "extension" as const,
        importPath: ext.importPath,
      }));
      const all =
        kind === "library"
          ? libraryEntries
          : kind === "extension"
            ? extensionEntries
            : [...libraryEntries, ...extensionEntries];
      const filtered = filter
        ? all.filter((c) => c.id.toLowerCase().includes(filter.toLowerCase()))
        : all;
      const out =
        (mode ?? "summary") === "full"
          ? filtered.map(trimLargeEnums)
          : filtered.map((c) => {
              const summary = toSummary(c);
              // Carry the kind + importPath through the summary view so the
              // agent can decide between two same-named components without
              // re-fetching the full descriptor.
              return {
                ...summary,
                kind: c.kind,
                ...("importPath" in c ? { importPath: c.importPath } : {}),
              };
            });
      return jsonResult(out);
    },
  );

  mcp.registerTool(
    "get_theme",
    {
      description:
        "Return a theme token tree — the default, or a named theme via theme (see list_themes). `typography.typesets` holds the rhythm controls; the extra `typeScale` field shows what the default typeset's three controls actually compute to per role (h1–h6, body, lead, small, caption), so you can check proportions without deriving them yourself. Adjust via set_typeset, not by setting sizes per node.",
      inputSchema: {
        theme: z.string().optional().describe('Named theme to read; default "default"'),
      },
    },
    async (args) => {
      const resolved = resolveNamedTheme(ctx.folder, args.theme);
      if (!resolved.ok) {
        return errorResult({ kind: "BadRequest", message: resolved.message });
      }
      const typography = resolved.theme.typography;
      return jsonResult({
        ...resolved.theme,
        typeScale: typesetScale(typography.typesets?.[DEFAULT_TYPESET_NAME], {
          ...(typography.fontFamily ? { fontFamily: typography.fontFamily } : {}),
        }),
      });
    },
  );

  mcp.registerTool(
    "list_snippets",
    {
      description:
        "List every snippet defined in the folder's snippets/. Returns { id, name, params } per entry; each param reports `name`, `type`, and `required` (true when it has no default and isn't optional). Read these before instantiate_snippet — passing the wrong set returns SnippetParamMismatch.",
      inputSchema: {},
    },
    async () => {
      const snippets = [...ctx.folder.snippets.entries()].map(([id, snippet]) => ({
        id,
        name: snippet.name,
        params: snippet.params.map(withRequiredFlag),
      }));
      return jsonResult({ snippets });
    },
  );

  mcp.registerTool(
    "get_snippet",
    {
      description:
        "Return the full JSON for a single snippet (id, name, params, body tree). Each param reports a derived `required` flag (no default and not optional).",
      inputSchema: { snippetId: z.string() },
    },
    async ({ snippetId }) => {
      const snippet = ctx.folder.snippets.get(snippetId);
      if (!snippet) return errorResult(snippetNotFound(snippetId));
      return jsonResult({ ...snippet, params: snippet.params.map(withRequiredFlag) });
    },
  );

  mcp.registerTool(
    "list_annotations",
    {
      description:
        "List the annotations on a screen — designer-authored guidance plus any you pinned yourself. Each annotation is anchored to a specific node via a locator and carries an `author`; `resolved` is the resolved path (or null if the targeted node has since vanished — treat dangling annotations as low-priority). User-authored annotations are read-only to you; pin/remove your own with add_annotation / remove_annotation. The `body` field is markdown.",
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
        "List markdown notes on one board — commentary beside the frames or attached to a node (tour steps, review remarks, handoff context). An attached note carries `attachment` naming the frame, screen and node it anchors to. Writable via add_note / update_note / remove_note.",
      inputSchema: { boardId: z.string() },
    },
    async ({ boardId }) => {
      const notes = ctx.folder.notes.get(boardId) ?? [];
      return jsonResult({ notes });
    },
  );
}
