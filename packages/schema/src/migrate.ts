/**
 * On-disk format versioning + migrations.
 *
 * A design folder's format version lives in `.design/config.json` →
 * `schemaVersion` (one version for the whole folder; individual files carry
 * none). The loader refuses folders whose version doesn't match
 * {@link CURRENT_SCHEMA_VERSION} — older folders are migrated on disk by
 * `velloo upgrade`, newer ones need a newer binary.
 *
 * Migrations here are PURE raw-JSON → raw-JSON transforms (this package does
 * no I/O). The CLI's `upgrade` command owns reading/writing files and applies
 * these in order; each step migrates exactly one version.
 *
 * History:
 *   1 — the original format: legacy single-`library` config still parsed,
 *       `source` was free-form ("embedded:shadcn"/"registry:shadcn" aliases),
 *       the vendored `shadcn-react` provider was a valid library id, and
 *       `Annotation.author` was optional (absent = "user").
 *   2 — multi-library only (`libraries` + `defaultLibrary`), `source` is the
 *       enum "binary" | "cache" | "in-repo", `shadcn-react` retired in favor
 *       of `shadcn-upstream` (same canvas runtime, real install deferred to
 *       the host app), `author` required.
 *   3 — typography is typesets. The `fontSize` / `fontWeight` / `lineHeight` /
 *       `letterSpacing` records are gone and `typography` parses strictly, so
 *       a v2 theme file is now a hard validation failure rather than dead
 *       weight — hence the version gate.
 *   4 — designs carry their own `name` (formerly the `velloo.json` project
 *       key or a local record's `projectName`), and app-relative paths use the
 *       `app:` prefix instead of `project:`.
 */

import { isDesignName, toDesignName } from "./repo.ts";

export const CURRENT_SCHEMA_VERSION = 4;

/**
 * Read the format version off a raw (unvalidated) config object. Historical
 * folders always wrote `schemaVersion: 1`, so anything absent or malformed is
 * treated as 1 rather than an error — `velloo upgrade` then normalizes it.
 */
export function schemaVersionOf(rawConfig: unknown): number {
  if (typeof rawConfig !== "object" || rawConfig === null) return 1;
  const v = (rawConfig as Record<string, unknown>).schemaVersion;
  return typeof v === "number" && Number.isInteger(v) && v >= 1 ? v : 1;
}

type RawObject = Record<string, unknown>;

/**
 * Facts a pure migration can't read for itself. The CLI's upgrade supplies
 * them from the files around the folder.
 */
export interface MigrationContext {
  /** The design's name as its registration recorded it. */
  name?: string | undefined;
}

export interface FolderMigration {
  /** Migrates from exactly this version to `from + 1`. */
  from: number;
  /** One-line, user-facing description (printed by `velloo upgrade`). */
  summary: string;
  /** Transform the raw config.json object (already shallow-cloned). */
  config?(raw: RawObject, context: MigrationContext): RawObject;
  /** Transform one annotation entry from a `screens/<id>.annotations.json` sidecar. */
  annotation?(raw: RawObject): RawObject;
  /** Transform one `theme/<name>.json` document. */
  theme?(raw: RawObject): RawObject;
}

/** Prefix of a path resolved from the design's application root. */
export const APP_PATH_PREFIX = "app:";
const LEGACY_APP_PREFIX = "project:";

/** Library id assigned to a legacy single-library config when it is promoted. */
const LEGACY_LIBRARY_KEY = "default";

function migrateLibraryEntry(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null) return raw;
  const lib = { ...(raw as RawObject) };
  // Pre-v2 source vocabulary: both aliases meant "the snapshot inside the
  // velloo binary".
  if (lib.source === "embedded:shadcn" || lib.source === "registry:shadcn") {
    lib.source = "binary";
    lib.componentsPath = "binary";
  }
  // The vendored snapshot is no longer a user-facing provider. shadcn-upstream
  // keeps the same canvas runtime; a real install into the host app is offered
  // at agent handoff, so `componentsPath: "binary"` remains valid.
  if (lib.id === "shadcn-react") {
    lib.id = "shadcn-upstream";
  }
  return lib;
}

/**
 * The typography records the typeset replaced. All four were declared, written
 * by every preset, and read by nothing that painted — the sizes that actually
 * rendered were literal utility classes. `TypographySchema` is strict now, so
 * they have to go rather than linger as ignored keys.
 *
 * `fontWeight` and `letterSpacing` have no destination: both are per-role
 * constants in the ratio table, deliberately not among the three controls.
 */
const RETIRED_TYPOGRAPHY_KEYS = ["fontSize", "fontWeight", "lineHeight", "letterSpacing"] as const;

/**
 * Font *role* names to bind each typeset face to, in preference order. A theme
 * names its families freely, so rather than guess we look for the keys velloo's
 * own scaffolds, wizard, and CSS import have always written.
 */
const FACE_ROLE_CANDIDATES: Record<"fontBody" | "fontHeading" | "fontMono", string[]> = {
  fontBody: ["sans", "body", "base"],
  fontHeading: ["display", "heading", "serif"],
  fontMono: ["mono", "code"],
};

/** The base size the ratio table already assumes, in px. */
const IMPLIED_BASE_PX = 16;

function asObject(value: unknown): RawObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as RawObject)
    : undefined;
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

/**
 * Read a v2 theme's typography intent into a typeset. Only `fontSize.base` and
 * `lineHeight.normal` carry over — the rest of both records described a ladder
 * the typeset now derives, so restating any of it would freeze proportions that
 * are supposed to move with the three controls.
 */
function deriveTypeset(typography: RawObject): RawObject {
  const derived: RawObject = {};

  // 16px is what the ladder scales from anyway, so a folder that never tuned
  // the base keeps the container-relative `1em` default instead of being pinned
  // to an absolute size it never asked for.
  const base = positiveNumber(asObject(typography.fontSize)?.base);
  if (base !== undefined && base !== IMPLIED_BASE_PX) derived.size = base;

  const leading = positiveNumber(asObject(typography.lineHeight)?.normal);
  if (leading !== undefined) derived.leading = leading;

  const families = asObject(typography.fontFamily);
  if (families) {
    for (const [face, candidates] of Object.entries(FACE_ROLE_CANDIDATES)) {
      const role = candidates.find((name) => typeof families[name] === "string");
      if (role) derived[face] = role;
    }
  }

  return derived;
}

export const FOLDER_MIGRATIONS: FolderMigration[] = [
  {
    from: 1,
    summary:
      "multi-library config shape, source enum, shadcn-react → shadcn-upstream, required annotation author",
    config(raw) {
      const out = { ...raw };
      if (out.library !== undefined && out.libraries === undefined) {
        out.libraries = { [LEGACY_LIBRARY_KEY]: out.library };
        out.defaultLibrary = LEGACY_LIBRARY_KEY;
      }
      delete out.library;
      if (typeof out.libraries === "object" && out.libraries !== null) {
        out.libraries = Object.fromEntries(
          Object.entries(out.libraries as RawObject).map(([id, lib]) => [
            id,
            migrateLibraryEntry(lib),
          ]),
        );
      }
      out.schemaVersion = 2;
      return out;
    },
    annotation(raw) {
      if (raw.author === undefined) return { ...raw, author: "user" };
      return raw;
    },
  },
  {
    from: 2,
    summary:
      "typography scales → typesets (font roles bound, dead size/weight/tracking records dropped)",
    config(raw) {
      return { ...raw, schemaVersion: 3 };
    },
    theme(raw) {
      const typography = asObject(raw.typography);
      if (!typography) return raw;
      const next = { ...typography };

      // Binding the font roles is the load-bearing half of this: without
      // `fontBody` a migrated folder's typeset regions resolve to `inherit` and
      // quietly stop using the theme's own faces.
      const typesets = asObject(next.typesets);
      if (typesets?.default === undefined) {
        const derived = deriveTypeset(next);
        if (Object.keys(derived).length > 0) {
          next.typesets = { ...typesets, default: derived };
        }
      }

      for (const key of RETIRED_TYPOGRAPHY_KEYS) delete next[key];
      return { ...raw, typography: next };
    },
  },
  {
    from: 3,
    summary: "the design's name moves into its config; `project:` paths become `app:`",
    config(raw, context) {
      const out: RawObject = { ...raw, schemaVersion: 4 };
      if (typeof out.name !== "string" || !isDesignName(out.name)) {
        out.name = (context.name && toDesignName(context.name)) ?? "design";
      }
      const toApp = (path: unknown) =>
        typeof path === "string" && path.startsWith(LEGACY_APP_PREFIX)
          ? `${APP_PATH_PREFIX}${path.slice(LEGACY_APP_PREFIX.length)}`
          : path;
      const hostApp = asObject(out.hostApp);
      if (hostApp) out.hostApp = { ...hostApp, root: toApp(hostApp.root) };
      const hostApps = asObject(out.hostApps);
      if (hostApps) {
        out.hostApps = Object.fromEntries(
          Object.entries(hostApps).map(([key, app]) => {
            const entry = asObject(app);
            return [key, entry ? { ...entry, root: toApp(entry.root) } : app];
          }),
        );
      }
      const libraries = asObject(out.libraries);
      if (libraries) {
        out.libraries = Object.fromEntries(
          Object.entries(libraries).map(([key, lib]) => {
            const entry = asObject(lib);
            return [key, entry ? { ...entry, componentsPath: toApp(entry.componentsPath) } : lib];
          }),
        );
      }
      return out;
    },
  },
];

export interface MigrationRun {
  /** The migrated raw config, ready for `ConfigSchema.parse`. */
  config: RawObject;
  /** Summaries of the steps that ran, in order. Empty ⇒ already current. */
  applied: string[];
  /**
   * Per-annotation transform composed from the same steps — the CLI maps it
   * over every entry of every `*.annotations.json` sidecar it finds.
   */
  annotation: (raw: RawObject) => RawObject;
  /** Per-theme transform, applied to every `theme/<name>.json` in the folder. */
  theme: (raw: RawObject) => RawObject;
}

/**
 * Compose the migration chain from a folder's current version up to
 * {@link CURRENT_SCHEMA_VERSION}. Throws when the folder is FROM THE FUTURE
 * (version > current) — the caller should tell the user to upgrade velloo —
 * or when the chain has a gap (a bug in this module).
 */
export function planMigration(rawConfig: unknown, context: MigrationContext = {}): MigrationRun {
  const from = schemaVersionOf(rawConfig);
  if (from > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `Design folder uses schema version ${from}, newer than this velloo (v${CURRENT_SCHEMA_VERSION}). Upgrade velloo.`,
    );
  }
  const steps: FolderMigration[] = [];
  for (let v = from; v < CURRENT_SCHEMA_VERSION; v++) {
    const step = FOLDER_MIGRATIONS.find((m) => m.from === v);
    if (!step) throw new Error(`velloo: no migration step from schema version ${v} — bug.`);
    steps.push(step);
  }
  let config = { ...((rawConfig ?? {}) as RawObject) };
  for (const step of steps) {
    if (step.config) config = step.config(config, context);
  }
  // Even a no-step run normalizes the version field so `upgrade` is idempotent.
  config.schemaVersion = CURRENT_SCHEMA_VERSION;
  return {
    config,
    applied: steps.map((s) => s.summary),
    annotation: (raw) => steps.reduce((acc, step) => step.annotation?.(acc) ?? acc, raw),
    theme: (raw) => steps.reduce((acc, step) => step.theme?.(acc) ?? acc, raw),
  };
}
