import { createHash } from "node:crypto";

/**
 * Lockfile written to `<cache>/shadcn-upstream-lock.json` recording what
 * was fetched + the per-file checksums. Re-runs of the fetcher compare
 * checksums to detect upstream drift; mismatch is surfaced as a typed
 * error so the user can opt in to re-fetching rather than silently
 * picking up upstream changes.
 */
export interface ShadcnUpstreamLock {
  /** Human-readable version stamp — date the cache was fetched. */
  version: string;
  /** Full ISO timestamp of the fetch operation. */
  fetchedAt: string;
  /** Base URL the components were fetched from. */
  registry: string;
  /** shadcn style slug (e.g. "new-york"). */
  style: string;
  /** Per-component metadata: relative paths + checksums + npm deps. */
  components: Record<
    string,
    {
      /** Files written relative to the cache root (e.g. "ui/button.tsx"). */
      files: { path: string; sha256: string }[];
      /** npm packages this component imports from. The user's app needs these. */
      dependencies: string[];
      /** Other shadcn components this depends on (already in this lockfile). */
      registryDependencies: string[];
    }
  >;
}

export function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * Build a date-stamp version from a Date. The minute-granularity makes
 * back-to-back re-fetches produce distinct versions; consistent across
 * machines because we're using UTC.
 */
export function dateStampVersion(at: Date): string {
  const year = at.getUTCFullYear();
  const month = String(at.getUTCMonth() + 1).padStart(2, "0");
  const day = String(at.getUTCDate()).padStart(2, "0");
  const hour = String(at.getUTCHours()).padStart(2, "0");
  const minute = String(at.getUTCMinutes()).padStart(2, "0");
  return `${year}.${month}.${day}-${hour}${minute}`;
}

/**
 * Aggregate the npm packages the user's app would need to install to
 * use the fetched components. Walks every entry's `dependencies` field
 * and dedupes.
 */
export function aggregateDependencies(lock: ShadcnUpstreamLock): string[] {
  const set = new Set<string>();
  for (const entry of Object.values(lock.components)) {
    for (const d of entry.dependencies) set.add(d);
  }
  return [...set].sort();
}
