import type { FeedbackPrefs } from "@velloo/schema";
import { type FoundRepoManifest, readRepoManifest } from "./designs.ts";
import { writeJsonAtomic } from "./fs.ts";
import { localDesignOf } from "./project-location.ts";

/**
 * The repo-root `velloo.json` for preference reads. A malformed one reads as
 * absent here — the CLI's resolver owns failing loudly on a broken manifest,
 * and the daemon must not refuse to boot over a preference file.
 *
 * A local design has no repo manifest: its checkout's `velloo.json` is a
 * committed file, and a design that lives only on this machine keeps its
 * preferences in its own config instead.
 */
export async function findRepoManifest(startDir: string): Promise<FoundRepoManifest | null> {
  if (localDesignOf(startDir)) return null;
  return readRepoManifest(startDir);
}

/**
 * The repo's feedback consent, or null when it has never been answered —
 * which is what tells `init` whether to ask. Folder-level `config.feedback`
 * (written before the preference moved up here) is the caller's fallback.
 */
export async function readRepoFeedback(startDir: string): Promise<FeedbackPrefs | null> {
  const found = await findRepoManifest(startDir);
  const feedback = found?.manifest.feedback;
  // A committed `contactOk` is ignored — see {@link writeRepoFeedback}.
  return feedback ? { enabled: feedback.enabled } : null;
}

/**
 * Persist feedback consent at the repo root, leaving the designs list alone.
 * Returns the file written, or null when there's no manifest to write into —
 * a folder outside any registered repo keeps its answer in its own config.
 *
 * Only `enabled` is written: `contactOk` is the person's, and lives in
 * `~/.velloo/prefs.json`. A `contactOk` left in an older manifest is dropped
 * here rather than migrated, so it can't leak to whoever clones the repo next.
 */
export async function writeRepoFeedback(
  startDir: string,
  feedback: FeedbackPrefs,
): Promise<string | null> {
  const found = await findRepoManifest(startDir);
  if (!found) return null;
  if (found.legacy)
    throw new Error(
      `${found.path} is in the pre-designs format — run \`velloo upgrade\` to migrate it first.`,
    );
  await writeJsonAtomic(found.path, {
    ...found.manifest,
    feedback: { enabled: feedback.enabled },
  });
  return found.path;
}
