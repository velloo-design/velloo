import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { type FeedbackPrefs, REPO_MANIFEST_FILE, RepoManifestSchema } from "@velloo/schema";
import { writeJsonAtomic } from "./fs.ts";

export interface FoundRepoManifest {
  /** Absolute path of the velloo.json file. */
  path: string;
  /** Directory holding it — the repo root, as far as velloo is concerned. */
  dir: string;
  manifest: ReturnType<typeof RepoManifestSchema.parse>;
}

/**
 * Walk up from `startDir` for the repo-root `velloo.json`. A missing file
 * keeps walking; a malformed one reads as absent here — the CLI's resolver
 * owns failing loudly on a broken manifest, and the daemon must not refuse to
 * boot over a preference file.
 */
export async function findRepoManifest(startDir: string): Promise<FoundRepoManifest | null> {
  let dir = resolve(startDir);
  for (;;) {
    const path = join(dir, REPO_MANIFEST_FILE);
    try {
      const parsed = RepoManifestSchema.safeParse(JSON.parse(await readFile(path, "utf8")));
      if (parsed.success) return { path, dir, manifest: parsed.data };
      return null;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") return null;
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * The repo's feedback consent, or null when it has never been answered —
 * which is what tells `init` whether to ask. Folder-level `config.feedback`
 * (written before the preference moved up here) is the caller's fallback.
 */
export async function readRepoFeedback(startDir: string): Promise<FeedbackPrefs | null> {
  const found = await findRepoManifest(startDir);
  return found?.manifest.feedback ?? null;
}

/**
 * Persist feedback consent at the repo root, leaving the projects map alone.
 * Returns the file written, or null when there's no manifest to write into —
 * a folder outside any registered repo keeps its answer in its own config.
 */
export async function writeRepoFeedback(
  startDir: string,
  feedback: FeedbackPrefs,
): Promise<string | null> {
  const found = await findRepoManifest(startDir);
  if (!found) return null;
  await writeJsonAtomic(found.path, { ...found.manifest, feedback });
  return found.path;
}
