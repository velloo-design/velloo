import { existsSync, realpathSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  CURRENT_SCHEMA_VERSION,
  normalizeRepoManifest,
  planMigration,
  schemaVersionOf,
} from "@velloo/schema";
import {
  type FoundRepoManifest,
  findOwningManifest,
  loadDesignFolder,
  localDesignOf,
  recordedDesignName,
} from "@velloo/server";
import { TOOL_VERSION } from "./version.ts";

type RawObject = Record<string, unknown>;

interface Rewrite {
  /** Path relative to the folder root. */
  rel: string;
  next: string;
}

function isObject(value: unknown): value is RawObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const isAnnotationSidecar = (file: string) => file.endsWith(".annotations.json");

// Theme sidecars don't exist, so every .json under theme/ is a theme document.
const isThemeDocument = (file: string) => file.endsWith(".json");

/**
 * Plan the rewrites for one directory of JSON documents. Reads and transforms
 * everything up front so a parse failure aborts the whole upgrade with the
 * folder still untouched.
 */
async function planRewrites(
  folder: string,
  dir: string,
  matches: (file: string) => boolean,
  transform: (parsed: unknown) => unknown,
): Promise<Rewrite[]> {
  let files: string[] = [];
  try {
    files = await readdir(join(folder, dir));
  } catch {
    return [];
  }
  const out: Rewrite[] = [];
  for (const file of files.sort()) {
    if (!matches(file)) continue;
    const rel = join(dir, file);
    const prev = await readFile(join(folder, rel), "utf8");
    const next = `${JSON.stringify(transform(JSON.parse(prev)), null, 2)}\n`;
    if (next !== prev) out.push({ rel, next });
  }
  return out;
}

export interface UpgradeResult {
  /** Version the folder was at before the run. */
  from: number;
  to: number;
  /** Human summaries of the migration steps that ran. Empty ⇒ already current. */
  applied: string[];
  /** Files rewritten (relative to the folder root). Empty on dry runs and no-ops. */
  changedFiles: string[];
}

/**
 * Migrate a design folder on disk to {@link CURRENT_SCHEMA_VERSION}.
 * Idempotent — a current folder is a no-op. Throws on a folder from a newer
 * velloo, on unreadable JSON, and when the migrated folder fails validation
 * (in which case files HAVE been written; the error demands attention rather
 * than silently leaving a half-trusted folder).
 */
export async function upgradeFolder(
  folder: string,
  opts: { dryRun?: boolean | undefined } = {},
): Promise<UpgradeResult> {
  const configPath = join(folder, ".design", "config.json");
  const rawConfig: unknown = JSON.parse(await readFile(configPath, "utf8"));
  const from = schemaVersionOf(rawConfig);
  const manifest = await findOwningManifest(folder).catch(() => null);
  const run = planMigration(rawConfig, { name: legacyNameOf(folder, manifest) });
  const manifestFiles = manifest?.legacy ? [manifest.path] : [];

  if (run.applied.length === 0) {
    if (manifest?.legacy && !opts.dryRun) await migrateManifest(manifest);
    return {
      from,
      to: CURRENT_SCHEMA_VERSION,
      applied: [],
      changedFiles: manifestFiles,
    };
  }

  const rewrites = [
    ...(await planRewrites(folder, "screens", isAnnotationSidecar, (parsed) =>
      Array.isArray(parsed)
        ? parsed.map((e) =>
            typeof e === "object" && e !== null ? run.annotation(e as RawObject) : e,
          )
        : parsed,
    )),
    ...(await planRewrites(folder, "theme", isThemeDocument, (parsed) =>
      isObject(parsed) ? run.theme(parsed) : parsed,
    )),
  ];

  // The upgrade run is the natural moment to refresh the recorded tool version.
  const nextConfig = { ...run.config, toolVersion: TOOL_VERSION };

  const changedFiles = [
    join(".design", "config.json"),
    ...rewrites.map((r) => r.rel),
    ...manifestFiles,
  ];
  if (opts.dryRun) {
    return { from, to: CURRENT_SCHEMA_VERSION, applied: run.applied, changedFiles };
  }

  await writeFile(configPath, `${JSON.stringify(nextConfig, null, 2)}\n`, "utf8");
  for (const r of rewrites) {
    await writeFile(join(folder, r.rel), r.next, "utf8");
  }
  if (manifest?.legacy) await migrateManifest(manifest);

  // Full-folder validation: parse everything with the current schemas so the
  // user learns NOW if the migrated folder has any other problem.
  await loadDesignFolder(folder);

  return { from, to: CURRENT_SCHEMA_VERSION, applied: run.applied, changedFiles };
}

/** The name a pre-v4 registration gave the folder, if any. */
function legacyNameOf(folder: string, manifest: FoundRepoManifest | null): string | undefined {
  const local = localDesignOf(folder);
  if (local) return local.legacyName;
  const target = realOr(folder);
  for (const [path, name] of manifest?.legacyNames ?? []) {
    if (realOr(path) === target) return name;
  }
  return undefined;
}

function realOr(path: string): string {
  return existsSync(path) ? realpathSync(path) : resolve(path);
}

/**
 * Rewrite a pre-v4 `velloo.json` (`projects` map) to the `designs` list. The
 * map's keys were the only record of each design's name, so every listed
 * folder that doesn't carry one yet gets it first — including folders not yet
 * migrated, whose own upgrade then keeps it.
 */
async function migrateManifest(manifest: FoundRepoManifest): Promise<void> {
  for (const [path, name] of manifest.legacyNames) {
    if (recordedDesignName(path)) continue;
    const configPath = join(path, ".design", "config.json");
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(configPath, "utf8"));
    } catch {
      continue; // a stale entry: nothing to name
    }
    if (isObject(raw))
      await writeFile(configPath, `${JSON.stringify({ ...raw, name }, null, 2)}\n`);
  }
  const raw = JSON.parse(await readFile(manifest.path, "utf8")) as RawObject;
  await writeFile(
    manifest.path,
    `${JSON.stringify(normalizeRepoManifest(raw).manifest, null, 2)}\n`,
  );
}
