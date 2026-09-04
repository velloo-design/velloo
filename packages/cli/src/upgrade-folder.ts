import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CURRENT_SCHEMA_VERSION, planMigration, schemaVersionOf } from "@velloo/schema";
import { loadDesignFolder } from "@velloo/server";
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
  const run = planMigration(rawConfig);

  if (run.applied.length === 0) {
    return { from, to: CURRENT_SCHEMA_VERSION, applied: [], changedFiles: [] };
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

  const changedFiles = [join(".design", "config.json"), ...rewrites.map((r) => r.rel)];
  if (opts.dryRun) {
    return { from, to: CURRENT_SCHEMA_VERSION, applied: run.applied, changedFiles };
  }

  await writeFile(configPath, `${JSON.stringify(nextConfig, null, 2)}\n`, "utf8");
  for (const r of rewrites) {
    await writeFile(join(folder, r.rel), r.next, "utf8");
  }

  // Full-folder validation: parse everything with the current schemas so the
  // user learns NOW if the migrated folder has any other problem.
  await loadDesignFolder(folder);

  return { from, to: CURRENT_SCHEMA_VERSION, applied: run.applied, changedFiles };
}
