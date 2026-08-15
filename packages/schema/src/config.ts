import { z } from "zod";
import { ExtensionSchema } from "./extension.ts";

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
 *   "binary"           — components ship with the velloo binary (default
 *                        for the embedded shadcn snapshot, today).
 *   "cache"            — components live in `~/.velloo/...` keyed by
 *                        `projectId` (file-copy libs in external mode;
 *                        always-cache libs like MUI).
 *   "in-repo"          — components live inside the user's app folder.
 *                        `componentsPath` is the resolved location.
 *   "registry:shadcn"  — legacy alias for "binary" with the shadcn
 *                        snapshot, kept for round-tripping pre-Sprint-X
 *                        config files.
 *   "embedded:shadcn"  — legacy alias for "binary", same reason.
 *   "shared:<path>"    — experimental "point at the user's app components".
 *                        Designed in architecture.md; not yet implemented.
 *
 * `source` stays a free-form string so providers can introduce their own
 * vocabularies (e.g. host-repo scan modes) without churning this schema.
 */
export const LibrarySchema = z.object({
  /**
   * Component provider id. Existing folders use `"shadcn-react"`;
   * forthcoming providers add their own ids ("none", "mui", …). The
   * server's provider loader maps ids to factories.
   */
  id: z.enum(["shadcn-react", "none", "mui"]),
  version: z.string().min(1),
  source: z.string().min(1),
  /** Where the components live, relative to the design folder root. */
  componentsPath: z.string().min(1),
  /** Set when the source is experimental. */
  experimental: z.enum(["shared"]).optional(),
});

export type Library = z.infer<typeof LibrarySchema>;

export const CodegenConfigSchema = z.object({
  /** Import prefix for emitted shadcn imports. Defaults to "@/components/ui". */
  componentsAlias: z.string().min(1).optional(),
});

export type CodegenConfig = z.infer<typeof CodegenConfigSchema>;

/**
 * Folder config. Multi-library: a folder registers N libraries by id
 * and pins one as the default; each screen optionally declares which
 * library it uses (`screen.library`), falling back to `defaultLibrary`.
 *
 * For backward compat the legacy single-library shape (`library:
 * Library`, no `libraries` / `defaultLibrary`) still parses. The
 * server's `migrateConfig` normalizes legacy configs in-memory so the
 * rest of the codebase only sees the multi-library shape. See
 * `decisions.md` #24.
 */
export const ConfigSchema = z
  .object({
    schemaVersion: z.literal(1),
    toolVersion: z.string().min(1),
    /**
     * Stable project id (UUID). Used to key external-cache locations
     * (`~/.velloo/<projectId>/...`) so a moved or renamed folder still
     * resolves its cached components.
     */
    projectId: z.string().min(1).optional(),
    /**
     * Legacy single-library shape. Folders created before Sprint Y
     * carry this field; the server migrates them in-memory at load.
     */
    library: LibrarySchema.optional(),
    /**
     * Multi-library shape (Sprint Y). Map of `libraryId → Library`.
     * Library ids are free-form strings the user picks (e.g.
     * "shadcn", "marketing", "internal"); the `Library.id` field
     * inside each entry still names the provider implementation.
     */
    libraries: z.record(z.string().min(1), LibrarySchema).optional(),
    /** Library id used when a screen doesn't declare one. */
    defaultLibrary: z.string().min(1).optional(),
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
    codegen: CodegenConfigSchema.optional(),
  })
  .refine(
    (c) => {
      const hasLegacy = c.library !== undefined;
      const hasMulti = c.libraries !== undefined || c.defaultLibrary !== undefined;
      // Exactly one shape must be present. Both forms together is ambiguous;
      // neither leaves the folder unable to render anything.
      if (hasLegacy && hasMulti) return false;
      if (!hasLegacy && !hasMulti) return false;
      // Multi-library form: both `libraries` and `defaultLibrary` required, and
      // `defaultLibrary` must refer to a registered entry.
      if (hasMulti) {
        if (!c.libraries || !c.defaultLibrary) return false;
        if (!(c.defaultLibrary in c.libraries)) return false;
      }
      return true;
    },
    {
      message:
        "Config must declare exactly one library shape: either legacy `library` OR (`libraries` + `defaultLibrary` where defaultLibrary names a registered entry).",
    },
  );

export type Config = z.infer<typeof ConfigSchema>;
