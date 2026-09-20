import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  COMPONENT_GROUPS,
  type ComponentDescriptor,
  type FrameworkAdapter,
  type Manifest,
  UNGROUPED_LABEL,
} from "@velloo/provider";
import { collectSerializedRefs, serializeTree } from "@velloo/renderer";
import {
  DEFAULT_TYPESET_NAME,
  isComponentNode,
  isParamRef,
  isSnippetInstance,
  type Node,
  nodeId,
  repoKey,
  type Screen,
  type Snippet,
  typesetScale,
} from "@velloo/schema";
import { z } from "zod";
import {
  activeBoards,
  type DesignFolder,
  orderedBoards,
  resolveNamedTheme,
} from "../../design-folder.ts";
import type { CanvasComponentDiagnostic } from "../../live/canvas-bundle.ts";
import { boardNotFound, screenNotFound, snippetNotFound } from "../../mutations/errors.ts";
import type { MutationContext } from "../../mutations/index.ts";
import { libraryIdForScreen, providerForScreen } from "../../mutations/lookup.ts";
import { unusedSnippetIds } from "../../mutations/snippet-refs.ts";
import { resolveLocator } from "../../path.ts";
import type { RepoCatalog, RepoCatalogEntry } from "../../repo/catalog.ts";
import { snippetJsxTags } from "../restricted-jsx.ts";
import { ListComponentsOutput } from "./outputs.ts";
import { errorResult, jsonResult, structuredResult } from "./result.ts";
import { screenMount } from "./screenshot-helpers.ts";

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
 * Build-time diagnostics refined by what the mounted frame found at runtime
 * (a throw, a missing provider, an unstyled render), and by which failed
 * components have a proxy standing in on this screen.
 */
function withRuntime(
  built: CanvasComponentDiagnostic[],
  runtime: CanvasComponentDiagnostic[] | undefined,
  proxied: Set<string>,
): CanvasComponentDiagnostic[] {
  const byId = new Map(built.map((entry) => [entry.id, { ...entry }]));
  for (const entry of runtime ?? []) {
    const current = byId.get(entry.id);
    byId.set(entry.id, { ...(current ?? {}), ...entry });
  }
  for (const entry of byId.values()) {
    if (entry.status === "unavailable" && proxied.has(entry.id)) entry.status = "proxy";
  }
  return [...byId.values()];
}

/** Repository keys whose nodes on this screen name a proxy snippet. */
function proxiedKeys(screen: Screen, snippets: Map<string, Snippet>): Set<string> {
  const out = new Set<string>();
  const visit = (node: Node, seen: Set<string>): void => {
    if (isSnippetInstance(node)) {
      const snippet = snippets.get(node.$snippet);
      if (snippet && !seen.has(snippet.id)) visit(snippet.tree, new Set([...seen, snippet.id]));
      return;
    }
    if (!isComponentNode(node)) return;
    if (node.$repo?.proxy) out.add(repoKey(node.$repo));
    for (const child of node.children ?? []) visit(child, seen);
  };
  visit(screen.tree, new Set());
  return out;
}

/** A catalog entry as `list_components` shows it. */
function repoListEntry(entry: RepoCatalogEntry) {
  const own = entry.props.filter((prop) => !prop.inherited);
  const familyId = entry.identity.member
    ? entry.id.slice(0, entry.id.length - entry.identity.member.length - 1)
    : entry.id;
  const notes = [
    entry.provenance.length > 0
      ? `Used at ${entry.provenance[0]}${entry.provenance.length > 1 ? ` (+${entry.provenance.length - 1})` : ""}.`
      : entry.viaFamily
        ? `Part of ${familyId}.`
        : undefined,
    entry.qualifiedBecause ? `Qualified: ${entry.qualifiedBecause}.` : undefined,
  ].filter(Boolean);
  return {
    id: entry.id,
    kind: "repo" as const,
    category: "ui" as const,
    source: entry.packageName ?? "app",
    group: `repo:${entry.packageName ?? "app"}`,
    family: familyId,
    ...(notes.length > 0 ? { designModeNotes: notes.join(" ") } : {}),
    importPath: entry.identity.importPath,
    exportName: entry.identity.exportName,
    ...(entry.identity.member ? { member: entry.identity.member } : {}),
    ...(entry.identity.app ? { app: entry.identity.app } : {}),
    ...(entry.recipe ? { recipe: entry.recipe } : {}),
    props: own,
    ...(own.length < entry.props.length ? { inheritedProps: entry.props.length - own.length } : {}),
    acceptsChildren: entry.acceptsChildren,
    styleProps: entry.styleProps,
    // What it reads for itself: preview it with that data present, or accept a
    // fallback. Props alone won't fill a component that reads a store.
    ...(entry.dataSources ? { dataSources: entry.dataSources.map((hook) => hook.name) } : {}),
    states: entry.states.slice(0, 4),
    ...(entry.parts ? { parts: entry.parts } : {}),
    provenance: entry.provenance,
    availableInDesign: true,
    installedInApp: true,
  };
}

type RepoListEntry = ReturnType<typeof repoListEntry>;

function repoSummary(entry: RepoListEntry): Record<string, unknown> {
  return {
    id: entry.id,
    kind: "repo",
    importPath: entry.importPath,
    props: entry.props.map((prop) => prop.name),
    ...(entry.states.length > 0 ? { states: entry.states.map((state) => state.name) } : {}),
    ...(entry.designModeNotes ? { designModeNotes: entry.designModeNotes } : {}),
    availableInDesign: true,
    installedInApp: true,
  };
}

function repoShelfLabel(group: string): string {
  const source = group.slice("repo:".length);
  return source === "app" ? "Repo · this app's components" : `Repo · ${source}`;
}

/** The setup state an agent needs before trusting the Repo shelves. */
function repoIndexNote(catalog: RepoCatalog): Record<string, unknown> {
  return {
    note: "Repo shelves are the app's own components: compose them by id. They render for real inside the preview entry (check it once with preview_status) and emit their exact imports.",
    apps: catalog.apps.map((app) => ({
      ...(app.app ? { app: app.app } : {}),
      preview: app.preview.label,
      ...(app.recipes.length > 0 ? { recipes: app.recipes } : {}),
    })),
    ...(catalog.warnings.length > 0 ? { warnings: catalog.warnings } : {}),
  };
}

/** The two shelves that aren't the library's: what this folder added itself. */
const EXTENSION_SHELF = { id: "extensions", label: "Extensions (this app's own)" } as const;
const SNIPPET_SHELF = { id: "snippets", label: "Snippets (your compositions)" } as const;

interface FamilyIndexEntry {
  id: string;
  /** Sub-components of this family, omitted when it is a lone component. */
  pieces?: string[];
  designModeNotes?: string;
}

interface ComponentIndex {
  groups: { group: string; label: string; families: FamilyIndexEntry[] }[];
  totals: { components: number; families: number };
  /** Only the exceptions — everything unlisted renders and is installed. */
  unavailableInDesign?: string[];
  notInstalledInApp?: string[];
}

interface IndexInput {
  id: string;
  group?: string | undefined;
  family?: string | undefined;
  designModeNotes?: string | undefined;
  availableInDesign: boolean;
  installedInApp: boolean;
}

/**
 * The browsing view: families on shelves, sub-pieces folded into their root.
 *
 * A per-entry list of 292 components spends ~27 of its 43 KB restating
 * `source`/`category`/`availableInDesign`/`installedInApp` that are identical
 * for all but a handful, and spends the rest on sub-piece names presented as
 * peers of their own root. This states the constants once, reports only the
 * exceptions, and lets the family shape carry the composition — so the default
 * first call costs roughly a fifth as much while saying more. Prop names come
 * from `mode: "summary"`/`"full"`, which are unchanged.
 */
export function componentIndex(
  entries: readonly IndexInput[],
  groupOrder: readonly { id: string; label: string }[],
  labelFor: (group: string | undefined) => string,
): ComponentIndex {
  const byGroup = new Map<string, Map<string, FamilyIndexEntry>>();
  for (const entry of entries) {
    // Ungrouped and family-less entries (a provider that sets neither, an
    // extension) still have to appear, so both fall back rather than drop.
    const group = entry.group ?? "";
    const familyId = entry.family ?? entry.id;
    const families = byGroup.get(group) ?? new Map<string, FamilyIndexEntry>();
    const family = families.get(familyId) ?? { id: familyId };
    if (entry.id !== familyId) family.pieces = [...(family.pieces ?? []), entry.id];
    // A note on the root describes the family; one on a piece (FieldError's
    // `errors` shape) would be lost here, so it is appended to the root's.
    if (entry.designModeNotes) {
      family.designModeNotes =
        entry.id === familyId
          ? [entry.designModeNotes, family.designModeNotes].filter(Boolean).join(" ")
          : [family.designModeNotes, `${entry.id}: ${entry.designModeNotes}`]
              .filter(Boolean)
              .join(" ");
    }
    families.set(familyId, family);
    byGroup.set(group, families);
  }
  const order = [...groupOrder.map((g) => g.id), ""];
  const groups = [...byGroup.entries()]
    .sort(([a], [b]) => order.indexOf(a) - order.indexOf(b))
    .map(([group, families]) => ({
      group: group === "" ? "other" : group,
      label: labelFor(group === "" ? undefined : group),
      families: [...families.values()]
        .map((family) => (family.pieces ? { ...family, pieces: family.pieces.sort() } : family))
        .sort((a, b) => a.id.localeCompare(b.id)),
    }));
  const index: ComponentIndex = {
    groups,
    totals: {
      components: entries.length,
      families: groups.reduce((sum, g) => sum + g.families.length, 0),
    },
  };
  const unavailable = entries.filter((e) => !e.availableInDesign).map((e) => e.id);
  const uninstalled = entries.filter((e) => !e.installedInApp).map((e) => e.id);
  if (unavailable.length > 0) index.unavailableInDesign = unavailable;
  if (uninstalled.length > 0) index.notInstalledInApp = uninstalled;
  return index;
}

/**
 * `list_boards`' payload, extracted so the selection rule is testable without
 * standing up an MCP session. Honors config.boardOrder so the agent sees the
 * same order as the canvas + /api/design (reorder_boards' effect would
 * otherwise be invisible here), and hides archived boards unless asked.
 */
export function listBoardsPayload(
  folder: DesignFolder,
  opts: { includeFrames?: boolean | undefined; includeArchived?: boolean | undefined } = {},
): Record<string, unknown>[] {
  const entries = opts.includeArchived ? orderedBoards(folder) : activeBoards(folder);
  const groups = new Map((folder.config.boardGroups ?? []).map((g) => [g.id, g.name]));
  return entries.map(([id, board]) => ({
    id,
    name: board.name,
    frameCount: board.frames.length,
    ...(board.group ? { group: groups.get(board.group) ?? board.group } : {}),
    ...(board.archivedAt ? { archivedAt: board.archivedAt } : {}),
    ...(opts.includeFrames ? { frames: board.frames, groups: board.groups } : {}),
  }));
}

export function registerDiscoveryTools(mcp: McpServer, ctx: MutationContext): void {
  mcp.registerTool(
    "list_screens",
    {
      description:
        "List every screen in the design folder. Pass `includeTree: true` to embed each screen's full tree — one round-trip instead of list_screens + N get_screen calls. Default false to keep responses small.",
      inputSchema: { includeTree: z.boolean().optional() },
    },
    async ({ includeTree }) => {
      const screens = [...ctx.folder.screens.entries()].map(([id, screen]) => ({
        id,
        name: screen.name,
        ...(includeTree ? { tree: screen.tree } : {}),
      }));
      return jsonResult({ screens });
    },
  );

  mcp.registerTool(
    "get_screen",
    {
      description:
        'Return one screen\'s JSON. `mode: "full"` (default) returns the complete tree; `"outline"` returns a stripped tree per node — {ref|snippet, $id?, classSnippet, children} — for an overview of a large screen before drilling in.',
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
        "List the folder's live boards in sidebar order, each with its own frames. `group` names the sidebar group a board is filed under (absent ⇒ ungrouped). `includeFrames: true` embeds each board's frame list; `includeArchived: true` also lists archived boards, which carry `archivedAt`.",
      inputSchema: {
        includeFrames: z.boolean().optional(),
        includeArchived: z.boolean().optional(),
      },
    },
    async ({ includeFrames, includeArchived }) =>
      jsonResult({ boards: listBoardsPayload(ctx.folder, { includeFrames, includeArchived }) }),
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
        'List the unified `compose` tag namespace: library components, extensions, and snippets. `mode: "index"` (default) groups families onto shelves with their sub-pieces folded in and carries per-family usage notes — read this first, then `filter` to the handful you will actually use. `"summary"` adds prop names per component; `"full"` returns whole descriptors with examples. A family entry means you compose its `pieces` inside it (`Field` ⇒ `FieldLabel`/`FieldDescription`/`FieldError`) — prefer a real family over rebuilding one from `Box` and `Text`. Snippet entries carry `snippetId`; their `id` is the PascalCase JSX tag. `installedInApp` is host-app status only; false does not block design, and `emit_code.componentsToInstall` carries the handoff plan. `filter` substring-matches tags; `kind` narrows the result. A snippet no screen reaches — directly or through another snippet — is marked `unused`; `unusedOnly: true` lists just those, which is how you find snippets a board delete or a screen rewrite left behind.',
      outputSchema: ListComponentsOutput,
      inputSchema: {
        filter: z.string().optional(),
        mode: z.enum(["index", "summary", "full"]).optional(),
        kind: z.enum(["library", "extension", "snippet", "repo"]).optional(),
        unusedOnly: z
          .boolean()
          .optional()
          .describe("Only snippets nothing reaches — implies kind: \u0022snippet\u0022"),
      },
    },
    async ({ filter, mode, kind, unusedOnly }) => {
      const manifest = await loadManifestForCtx(ctx);
      const provider = ctx.defaultProvider as FrameworkAdapter;
      const catalog = provider.catalog ? await provider.catalog().catch(() => []) : [];
      const catalogById = new Map(catalog.map((entry) => [entry.id, entry]));
      const libraryEntries = manifest.map((c) => {
        const status = catalogById.get(c.id);
        return {
          ...c,
          kind: "library" as const,
          availableInDesign: c.id in provider.registry,
          ...(status
            ? { installedInApp: status.installed, importPath: status.importPath }
            : { installedInApp: true }),
        };
      });
      const extensions = ctx.folder.config.extensions ?? {};
      const extensionEntries = Object.entries(extensions).map(([id, ext]) => ({
        id,
        category: ext.category ?? "ui",
        source: "extension",
        props: ext.props,
        designModeNotes: ext.description,
        kind: "extension" as const,
        importPath: ext.importPath,
        availableInDesign: true,
        installedInApp: true,
      }));
      // Unused rides in `designModeNotes` as well as its own field, so it's
      // visible in index mode too — that's the whole report, and it's the one
      // mode an agent reads first.
      const unused = new Set(unusedSnippetIds(ctx.folder));
      const snippetEntries = [...ctx.folder.snippets.values()].map((snippet) => ({
        id: snippetJsxTags(snippet)[0] ?? snippet.id,
        snippetId: snippet.id,
        category: "composition",
        source: "snippet",
        props: snippet.params.map(withRequiredFlag),
        designModeNotes: unused.has(snippet.id)
          ? `Reusable snippet: ${snippet.name} — unused: no screen reaches it`
          : `Reusable snippet: ${snippet.name}`,
        kind: "snippet" as const,
        availableInDesign: true,
        installedInApp: true,
        ...(unused.has(snippet.id) ? { unused: true as const } : {}),
      }));
      const repoCatalog = ctx.repo ? await ctx.repo.catalog().catch(() => null) : null;
      const repoEntries = (repoCatalog?.entries ?? []).map(repoListEntry);
      const all = unusedOnly
        ? snippetEntries.filter((entry) => unused.has(entry.snippetId))
        : kind === "library"
          ? libraryEntries
          : kind === "extension"
            ? extensionEntries
            : kind === "snippet"
              ? snippetEntries
              : kind === "repo"
                ? repoEntries
                : [...repoEntries, ...libraryEntries, ...extensionEntries, ...snippetEntries];
      const filtered = filter
        ? all.filter((c) => c.id.toLowerCase().includes(filter.toLowerCase()))
        : all;
      if ((mode ?? "index") === "index") {
        // Extensions and snippets get shelves of their own: they are the two
        // layers the agent adds, so burying them among 66 library families
        // would hide exactly the components this folder chose to have.
        // The app's own components come first: prefer them over rebuilding
        // one from primitives. One shelf per source, so provenance is visible.
        const repoShelves = [...new Set(repoEntries.map((entry) => entry.group))].map((id) => ({
          id,
          label: repoShelfLabel(id),
        }));
        const order = [...repoShelves, ...COMPONENT_GROUPS, EXTENSION_SHELF, SNIPPET_SHELF];
        const shelfOf = (group: string | undefined): string =>
          order.find((g) => g.id === group)?.label ?? UNGROUPED_LABEL;
        const index = componentIndex(
          filtered.map((c) => ({
            id: c.id,
            group:
              c.kind === "extension"
                ? EXTENSION_SHELF.id
                : c.kind === "snippet"
                  ? SNIPPET_SHELF.id
                  : "group" in c
                    ? c.group
                    : undefined,
            family: "family" in c ? c.family : undefined,
            designModeNotes: c.designModeNotes,
            availableInDesign: c.availableInDesign,
            installedInApp: c.installedInApp,
          })),
          order,
          shelfOf,
        );
        return structuredResult({
          snapshotVersion: ctx.defaultProvider.version,
          ...index,
          ...(repoCatalog && repoEntries.length > 0 ? { repo: repoIndexNote(repoCatalog) } : {}),
        });
      }
      const out =
        mode === "full"
          ? filtered.map((entry) =>
              entry.kind === "snippet" || entry.kind === "repo" ? entry : trimLargeEnums(entry),
            )
          : filtered.map((c) => {
              if (c.kind === "repo") return repoSummary(c);
              const summary =
                c.kind === "snippet"
                  ? {
                      id: c.id,
                      category: c.category,
                      source: c.source,
                      props: c.props.map((prop) => prop.name),
                      designModeNotes: c.designModeNotes,
                    }
                  : toSummary(c);
              // Carry the kind + importPath through the summary view so the
              // agent can decide between two same-named components without
              // re-fetching the full descriptor.
              return {
                ...summary,
                kind: c.kind,
                availableInDesign: c.availableInDesign,
                installedInApp: c.installedInApp,
                ...(c.kind === "snippet"
                  ? { snippetId: c.snippetId, ...("unused" in c ? { unused: c.unused } : {}) }
                  : {}),
                ...("importPath" in c ? { importPath: c.importPath } : {}),
              };
            });
      return structuredResult({ snapshotVersion: ctx.defaultProvider.version, components: out });
    },
  );

  mcp.registerTool(
    "component_status",
    {
      description:
        'Report how components render: exact host source, canvas-adapted source, a real bundled framework adapter, fallback, or unavailable. Pass `screen` to check exactly the components a screen uses and whether it client-mounts host source. Or pass `ids` (e.g. { ids: ["Button", "Card"] }) — the same ids `list_components` returns. `renderable` describes whether Velloo can render it; `hostMount` is the separate host-app browser-mount capability.',
      inputSchema: {
        ids: z.array(z.string().min(1)).min(1).optional(),
        screen: z
          .string()
          .min(1)
          .optional()
          .describe("Screen id: report the components it uses and whether it mounts"),
        library: z.string().min(1).optional().describe("With `ids`; a screen names its own"),
      },
    },
    async ({ ids, screen: screenId, library }) => {
      if (screenId !== undefined) {
        const screen = ctx.folder.screens.get(screenId);
        if (!screen) return errorResult(screenNotFound(screenId));
        if (!ctx.canvasBundler) {
          return errorResult({
            kind: "BadRequest",
            message: "component_status { screen } needs the canvas daemon's bundler.",
          });
        }
        const mount = await screenMount(ctx, ctx.canvasBundler, screen);
        if (mount.kind === "none") {
          const provider = providerForScreen(ctx, screen) as FrameworkAdapter;
          const libraryId = libraryIdForScreen(ctx, screen);
          if (!provider.canvasBundleSpec) {
            const manifest = await provider.loadManifest().catch(() => []);
            const known = new Set(manifest.map((entry) => entry.id));
            const refs = collectSerializedRefs(
              serializeTree(screen.tree, { snippets: ctx.folder.snippets }),
            ).filter((id) => known.has(id));
            return jsonResult({
              library: libraryId,
              screen: screenId,
              renderable: true,
              renderSource: "bundled-adapter",
              hostMount: { supported: false, mounted: false },
              note: "This screen renders through Velloo's bundled framework adapter using the real library runtime. Host-app client mounting is not supported by this adapter; that does not make its components unusable.",
              diagnostics: refs.map((id) => ({
                id,
                status: "bundled",
                note: "Rendered by the real library through Velloo's bundled adapter.",
              })),
              errors: [],
            });
          }
          return jsonResult({
            screen: screenId,
            mounted: false,
            note: "This screen's library renders server-side only, or the screen uses no components — there is no app mount to report on.",
            diagnostics: [],
            errors: [],
          });
        }
        return jsonResult({
          library: mount.libraryId,
          screen: screenId,
          mounted: mount.kind === "mounted",
          ...(mount.kind === "server"
            ? {
                note: `The canvas and every capture render this screen from Velloo's bundled components, not the app's own, because ${mount.reason}. Statuses below describe each component's source; none of them reaches the screen until the blocking ones are fixed or replaced.`,
              }
            : {}),
          diagnostics: withRuntime(
            mount.bundle?.diagnostics ?? [],
            mount.kind === "mounted" ? ctx.canvasBundler.runtimeDiagnostics(mount.refs) : undefined,
            proxiedKeys(screen, ctx.folder.snippets),
          ),
          ...(mount.kind === "mounted" && mount.refs.some((ref) => ref.startsWith("repo:"))
            ? {
                runtimeChecked: ctx.canvasBundler.runtimeDiagnostics(mount.refs) !== undefined,
                ...(mount.bundle.metrics ? { build: mount.bundle.metrics } : {}),
              }
            : {}),
          errors: mount.bundle?.errors ?? [],
        });
      }
      if (!ids) {
        return errorResult({
          kind: "BadRequest",
          message: 'Pass `screen` (a screen id) or `ids` (component ids), e.g. { screen: "home" }.',
        });
      }
      const libraryId = library ?? ctx.folder.config.defaultLibrary;
      const provider = ctx.providers[libraryId] as FrameworkAdapter | undefined;
      if (!provider) {
        return errorResult({
          kind: "BadRequest",
          message: `Unknown library ${JSON.stringify(libraryId)}.`,
        });
      }
      // Split unknown ids off FIRST, whatever the provider can do. An id that
      // isn't in the library at all otherwise reads identically to a real
      // component the canvas can't mount — so a model asking about a component
      // the app calls by its own name (for example Panel / StatusChip) would be
      // told the canvas is broken rather than that the id is wrong.
      const manifest = await provider.loadManifest().catch(() => []);
      const known = new Set(manifest.map((entry) => entry.id));
      // The app's own components answer by catalog id through the same
      // bundler a screen would mount them with.
      const repoCatalog = ctx.repo ? await ctx.repo.catalog().catch(() => null) : null;
      const repoIds = ids.filter((id) => !known.has(id) && repoCatalog?.byId.has(id));
      const repoDiagnostics =
        repoIds.length > 0 && ctx.canvasBundler
          ? (
              await ctx.canvasBundler.build(
                libraryId,
                repoIds.map((id) => repoCatalog?.byId.get(id)?.key as string),
              )
            ).diagnostics.map((entry) => ({
              ...entry,
              id: repoIds.find((id) => repoCatalog?.byId.get(id)?.key === entry.id) ?? entry.id,
            }))
          : [];
      const unknownDiagnostics = ids
        .filter((id) => !known.has(id) && !repoIds.includes(id))
        .map((id) => ({
          id,
          status: "unknown" as const,
          note: "Not a component in this library or the app's repo catalog — call list_components for the ids it accepts.",
        }));
      const recognized = ids.filter((id) => known.has(id));

      if (!provider.canvasBundleSpec || !ctx.canvasBundler) {
        return jsonResult({
          library: libraryId,
          renderable: true,
          renderSource: "bundled-adapter",
          hostMount: { supported: false, mounted: false },
          diagnostics: [
            ...recognized.map((id) => ({
              id,
              status: "bundled",
              note: "Rendered by the real library through Velloo's bundled adapter; host-app client mounting is unavailable.",
            })),
            ...repoDiagnostics,
            ...unknownDiagnostics,
          ],
          errors: [],
        });
      }
      const result = recognized.length
        ? await ctx.canvasBundler.build(libraryId, recognized)
        : { usable: false, diagnostics: [], errors: [] };
      return jsonResult({
        library: libraryId,
        usable: result.usable,
        diagnostics: [...result.diagnostics, ...repoDiagnostics, ...unknownDiagnostics],
        errors: result.errors,
      });
    },
  );

  mcp.registerTool(
    "get_theme",
    {
      description:
        "Return a theme token tree — the default, or a named one via `theme` — plus the folder's `customCss`. `typography.typesets` holds the rhythm controls and `typeScale` shows what they compute to per role. Adjust via `set_theme`, not per-node sizes.",
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
        customCss: ctx.folder.customCss,
      });
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
        "List a screen's annotations — designer-authored guidance plus any you pinned. Each is anchored to a node and carries an `author`; `resolved` is the live path, or null when the targeted node has vanished (treat those as low-priority). User-authored ones are read-only to you. Bodies are markdown.",
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
        "List the markdown notes on one board — commentary beside the frames or attached to a node (tour steps, review remarks, handoff context). An attached note carries `attachment` naming the frame, screen and node it anchors to.",
      inputSchema: { boardId: z.string() },
    },
    async ({ boardId }) => {
      const notes = ctx.folder.notes.get(boardId) ?? [];
      return jsonResult({ notes });
    },
  );
}
