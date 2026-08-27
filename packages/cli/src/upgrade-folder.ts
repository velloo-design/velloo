import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CURRENT_SCHEMA_VERSION, planMigration, schemaVersionOf } from "@velloo/schema";
import { loadDesignFolder } from "@velloo/server";
import { TOOL_VERSION } from "./version.ts";

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
  opts: { dryRun?: boolean } = {},
): Promise<UpgradeResult> {
  const configPath = join(folder, ".design", "config.json");
  const rawConfig: unknown = JSON.parse(await readFile(configPath, "utf8"));
  const from = schemaVersionOf(rawConfig);
  const run = planMigration(rawConfig);

  if (run.applied.length === 0) {
    return { from, to: CURRENT_SCHEMA_VERSION, applied: [], changedFiles: [] };
  }

  // Collect annotation sidecar rewrites before writing anything, so a parse
  // failure aborts with the folder untouched.
  const sidecars: Array<{ rel: string; next: string }> = [];
  const screensDir = join(folder, "screens");
  let screenFiles: string[] = [];
  try {
    screenFiles = await readdir(screensDir);
  } catch {
    // No screens/ dir — nothing to migrate there.
  }
  for (const file of screenFiles.sort()) {
    if (!file.endsWith(".annotations.json")) continue;
    const path = join(screensDir, file);
    const entries: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!Array.isArray(entries)) continue;
    const next = entries.map((e) =>
      typeof e === "object" && e !== null ? run.annotation(e as Record<string, unknown>) : e,
    );
    const nextText = `${JSON.stringify(next, null, 2)}\n`;
    const prevText = await readFile(path, "utf8");
    if (nextText !== prevText) sidecars.push({ rel: join("screens", file), next: nextText });
  }

  // The upgrade run is the natural moment to refresh the recorded tool version.
  const nextConfig = { ...run.config, toolVersion: TOOL_VERSION };

  const changedFiles = [join(".design", "config.json"), ...sidecars.map((s) => s.rel)];
  if (opts.dryRun) {
    return { from, to: CURRENT_SCHEMA_VERSION, applied: run.applied, changedFiles };
  }

  await writeFile(configPath, `${JSON.stringify(nextConfig, null, 2)}\n`, "utf8");
  for (const s of sidecars) {
    await writeFile(join(folder, s.rel), s.next, "utf8");
  }

  // Full-folder validation: parse everything with the current schemas so the
  // user learns NOW if the migrated folder has any other problem.
  await loadDesignFolder(folder);

  return { from, to: CURRENT_SCHEMA_VERSION, applied: run.applied, changedFiles };
}
