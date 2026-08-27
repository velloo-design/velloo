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
 */

export const CURRENT_SCHEMA_VERSION = 2;

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

export interface FolderMigration {
  /** Migrates from exactly this version to `from + 1`. */
  from: number;
  /** One-line, user-facing description (printed by `velloo upgrade`). */
  summary: string;
  /** Transform the raw config.json object (already shallow-cloned). */
  config?(raw: RawObject): RawObject;
  /** Transform one annotation entry from a `screens/<id>.annotations.json` sidecar. */
  annotation?(raw: RawObject): RawObject;
}

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
}

/**
 * Compose the migration chain from a folder's current version up to
 * {@link CURRENT_SCHEMA_VERSION}. Throws when the folder is FROM THE FUTURE
 * (version > current) — the caller should tell the user to upgrade velloo —
 * or when the chain has a gap (a bug in this module).
 */
export function planMigration(rawConfig: unknown): MigrationRun {
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
    if (step.config) config = step.config(config);
  }
  // Even a no-step run normalizes the version field so `upgrade` is idempotent.
  config.schemaVersion = CURRENT_SCHEMA_VERSION;
  return {
    config,
    applied: steps.map((s) => s.summary),
    annotation: (raw) => steps.reduce((acc, step) => step.annotation?.(acc) ?? acc, raw),
  };
}
