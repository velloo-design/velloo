import { z } from "zod";
import { BoardGroupSchema } from "./board.ts";
import { ExtensionSchema } from "./extension.ts";
import { CURRENT_SCHEMA_VERSION } from "./migrate.ts";
import { FeedbackPrefsSchema } from "./repo.ts";

export const ViewportPresetSchema = z.object({
  name: z.string().min(1),
  w: z.number().int().positive(),
  h: z.number().int().positive(),
});

export type ViewportPreset = z.infer<typeof ViewportPresetSchema>;

/**
 * Library declaration. The `id` selects which component provider the
 * design folder is built against (see `@velloo/provider`). `source`
 * tells the loader where the components live for that provider:
 *
 *   "binary"   — components ship with the velloo binary (the canvas
 *                runtime for shadcn-upstream, and all of none/mui).
 *   "cache"    — components live under `~/.velloo/…`.
 *   "in-repo"  — components live inside the user's app folder.
 *                `componentsPath` is the resolved location.
 */
export const LibrarySchema = z.object({
  /**
   * Component provider id. The server's provider loader maps ids to
   * factories; `"shadcn-upstream"` is the default for new folders.
   */
  id: z.enum(["shadcn-upstream", "none", "mui", "antd", "chakra"]),
  version: z.string().min(1),
  source: z.enum(["binary", "cache", "in-repo"]),
  /** Where the components live, relative to the design folder root. */
  componentsPath: z.string().min(1),
});

export type Library = z.infer<typeof LibrarySchema>;

export const CodegenConfigSchema = z.object({
  /** Import prefix for emitted shadcn imports. Defaults to "@/components/ui". */
  componentsAlias: z.string().min(1).optional(),
  /**
   * Where the app's UI components live, relative to the app root — what
   * `init` asked (or detected). Recorded so a *second* design folder in the
   * same repo inherits the answer instead of asking again.
   */
  componentsDir: z.string().min(1).optional(),
});

export type CodegenConfig = z.infer<typeof CodegenConfigSchema>;

/**
 * Where the host app lives, used by the live-island bundler to resolve
 * a `render:"live"` extension's `importPath` (and its dependencies, e.g.
 * the app's own recharts) into a browser bundle. `root` is absolute or
 * resolved from the design folder root; absent ⇒ the bundler defaults to
 * the design folder's parent (the `<appRoot>/velloo` layout `init`
 * produces). `aliases` mirrors the host tsconfig path map (e.g.
 * `{ "@/*": "src/*" }`); absent ⇒ `{ "@/*": "*" }`. Reading the host
 * tsconfig per build is fragile (JSON5, `extends` chains), so it's
 * persisted once at registration time.
 */
export const HostAppSchema = z.object({
  root: z.string().min(1),
  aliases: z.record(z.string().min(1), z.string().min(1)).optional(),
});

export type HostApp = z.infer<typeof HostAppSchema>;

/**
 * Folder config. Multi-library: a folder registers N libraries by id
 * and pins one as the default; each screen optionally declares which
 * library it uses (`screen.library`), falling back to `defaultLibrary`.
 *
 * `schemaVersion` gates loading: the server refuses folders on any
 * other version (older ⇒ `velloo upgrade` migrates them on disk — see
 * `migrate.ts`; newer ⇒ the binary is too old).
 */
export const ConfigSchema = z
  .object({
    schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
    toolVersion: z.string().min(1),
    /**
     * Stable folder identity for velloo-cloud (a UUID). Published share links
     * carry it server-side, so every clone of the folder finds its links (and
     * their comments) by id — no committed link records. `init` generates it;
     * pre-existing folders get one lazily on their first `velloo publish`.
     * Optional because it's meaningless until the folder touches the cloud.
     */
    folderId: z
      .string()
      .regex(/^[A-Za-z0-9_-]{8,64}$/)
      .optional(),
    /**
     * Map of `libraryId → Library`. Library ids are free-form strings
     * the user picks (e.g. "shadcn", "marketing", "internal"); the
     * `Library.id` field inside each entry still names the provider
     * implementation.
     */
    libraries: z.record(z.string().min(1), LibrarySchema),
    /** Library id used when a screen doesn't declare one. */
    defaultLibrary: z.string().min(1),
    /**
     * User-declared custom components. The agent adds these via the
     * `add_extension` MCP tool when a screen needs a component the
     * active library doesn't have. Keyed by component id; ids
     * shadow library components of the same name.
     */
    extensions: z.record(z.string().min(1), ExtensionSchema).optional(),
    viewportPresets: z.array(ViewportPresetSchema).min(1),
    /** Screen id the canvas should focus on first load. Falls back to the first screen. */
    defaultScreen: z.string().min(1).optional(),
    /** Board id the canvas should open on first load. Falls back to the first board. */
    defaultBoard: z.string().min(1).optional(),
    /**
     * Left-sidebar display order of boards, as board ids. The canvas
     * writes this when the user drags boards to reorder them. Boards not
     * listed fall to the end in filename (alphabetical) order; ids that
     * no longer resolve are ignored. Absent ⇒ filename order — the
     * historical default, so existing folders are unaffected.
     */
    boardOrder: z.array(z.string().min(1)).optional(),
    /**
     * Sidebar groups of boards, in display order — an area of work ("Side
     * pane", "Account page") holding a set of boards. A board points at one
     * via `Board.group`; boards pointing at nothing render under Ungrouped.
     * `boardOrder` still orders boards *within* a group. Absent ⇒ today's
     * flat list, so existing folders are unaffected.
     */
    boardGroups: z.array(BoardGroupSchema).optional(),
    codegen: CodegenConfigSchema.optional(),
    /**
     * The folder's CSS framework — the styling axis, independent of the
     * component library (`library`). `init` detects it from the host app.
     * `"tailwind"` ⇒ Tailwind utility classes on `className`; `"none"` ⇒ inline
     * `style` objects (themed via the CSS vars `themeToCss` injects, no build
     * step). Absent ⇒ the active library's default channel (Tailwind for
     * shadcn/none, `sx` for MUI). Honored per screen only when that screen's
     * library supports it — a shadcn screen stays Tailwind even here. The
     * server rejects a folder whose CSS framework no registered library
     * supports (e.g. shadcn + none).
     */
    styling: z.object({ framework: z.enum(["tailwind", "none"]) }).optional(),
    /** Host app location for the live-island bundler. See `HostAppSchema`. */
    hostApp: HostAppSchema.optional(),
    /**
     * Named host apps for monorepos — the multi-app twin of `hostApp`, keyed
     * by a short app name (`"web"`, `"admin"`; `init`'s multi-app scan uses
     * the same prefixes as the screen ids it generates). An extension can
     * pick its app via `extension.app`, so its live island bundles against
     * that app's root/aliases/node_modules (and its React copy). `hostApp`
     * stays the default for extensions that don't name one. Absent ⇒
     * single-app folder, everything resolves through `hostApp`.
     */
    hostApps: z.record(z.string().min(1), HostAppSchema).optional(),
    /**
     * Opt-in product feedback. Set during interactive `init` (after the user
     * signs in). When `enabled`, the server exposes the `send_feedback` MCP
     * tool, which posts free-text feedback about Velloo to velloo-cloud.
     * `contactOk` records consent to be contacted about that feedback. Absent
     * ⇒ disabled (the default; the local tool stays account-free + offline).
     */
    /**
     * @deprecated Feedback consent is a repo-level preference now, stored in
     * `velloo.json` — it's about the person, not the design folder, and a
     * repo with several folders shouldn't ask (or answer) it twice. Still
     * read as the fallback for folders written before the move; never
     * written.
     */
    feedback: FeedbackPrefsSchema.optional(),
  })
  .refine((c) => c.defaultLibrary in c.libraries, {
    message: "`defaultLibrary` must name an entry in `libraries`.",
  });

export type Config = z.infer<typeof ConfigSchema>;
