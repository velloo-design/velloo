import { type FetchResult, fetchShadcn } from "./fetcher.ts";
import { aggregateDependencies, type ShadcnUpstreamLock } from "./lock.ts";
import { writeManifest } from "./manifest.ts";

/**
 * High-level "install or refresh" flow that `velloo init` (and any
 * future `velloo upgrade`) calls. Fetches the configured component
 * subset, writes the cache layout, generates a manifest, and returns
 * a summary the wizard prints.
 */
export interface InstallOptions {
  /** Absolute destination directory. */
  destination: string;
  /** Component ids to fetch. Defaults to the full canonical surface. */
  components?: readonly string[];
  /** Registry style. Defaults to "new-york". */
  style?: string;
  /** Custom fetch (tests inject a mock). */
  fetchImpl?: typeof fetch;
}

export interface InstallResult {
  destination: string;
  lock: ShadcnUpstreamLock;
  /** Aggregated npm packages the user's app needs to install. */
  npmDependencies: string[];
  /** Files written, useful for the wizard's "X files installed" line. */
  filesWritten: string[];
}

export async function installShadcnUpstream(opts: InstallOptions): Promise<InstallResult> {
  const fetched: FetchResult = await fetchShadcn(opts);
  // Generate manifest from the freshly-fetched .tsx so the inspector
  // sees prop schemas that match the upstream shape exactly. The
  // manifest lives next to the components at `<cache>/manifest.json`.
  await writeManifest(opts.destination);
  return {
    destination: opts.destination,
    lock: fetched.lock,
    npmDependencies: aggregateDependencies(fetched.lock),
    filesWritten: fetched.filesWritten,
  };
}
