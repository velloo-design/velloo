import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { SHADCN_COMPONENT_IDS } from "./components.ts";
import { hashContent, type ShadcnUpstreamLock } from "./lock.ts";

/**
 * Pinned shadcn registry version. The public registry has no versioned
 * endpoint, so reproducibility rests on three things: this stable version
 * label (recorded in the lock instead of a fetch timestamp), the per-file
 * SHA256 checksums the lock carries, and the fetcher throwing on any missing
 * /renamed component — so a registry-shape change surfaces loudly rather than
 * silently drifting. Bump deliberately, in lockstep with the vendored
 * snapshot.
 */
export const SHADCN_REGISTRY_VERSION = "2026.05.22";

/**
 * Shape of shadcn's registry response per component. Documented at
 * <https://ui.shadcn.com/docs/registry/registry-item-json>.
 */
export interface ShadcnRegistryItem {
  $schema?: string;
  name: string;
  type?: string;
  /** npm packages this component imports from (e.g. "@radix-ui/react-dialog"). */
  dependencies?: string[];
  /** Other shadcn registry items this depends on (e.g. "button" for some compounds). */
  registryDependencies?: string[];
  files: { path: string; content: string; type?: string; target?: string }[];
}

/** Standard shadcn `lib/utils.ts` — the `cn()` helper. */
export const LIB_UTILS_CONTENT = `import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
`;

export interface FetchOptions {
  /** Destination directory. Components land at `<destination>/ui/<id>.tsx`. */
  destination: string;
  /** Component ids to fetch. Defaults to the canonical SHADCN_COMPONENT_IDS list. */
  components?: readonly string[];
  /** Registry style slug. Defaults to `"new-york"`. */
  style?: string;
  /** Override base URL for testing (defaults to the public shadcn registry). */
  registryBase?: string;
  /** Override the pinned version recorded in the lock (defaults to SHADCN_REGISTRY_VERSION). */
  version?: string;
  /**
   * Custom fetch implementation. Tests inject a mock; production
   * defaults to `globalThis.fetch`.
   */
  fetchImpl?: typeof fetch;
  /**
   * Allow a non-HTTPS `registryBase`. Off by default — plain HTTP lets a MITM
   * swap in a hostile registry response (which controls the files written), so
   * the fetcher refuses it. Tests pointing at a local server opt in explicitly.
   */
  allowInsecure?: boolean;
}

export interface FetchResult {
  lock: ShadcnUpstreamLock;
  lockPath: string;
  /** Absolute paths of every file written. */
  filesWritten: string[];
}

const DEFAULT_REGISTRY = "https://ui.shadcn.com/r/styles";

/**
 * Fetch a shadcn component subset from upstream and write it to a cache
 * directory. Produces a lockfile recording version + per-file
 * checksums so subsequent runs can detect upstream drift.
 *
 * The fetcher does not generate the manifest (that requires walking
 * the .tsx with ts-morph) — `generateManifest` in `manifest.ts` is the
 * follow-up step.
 */
export async function fetchShadcn(opts: FetchOptions): Promise<FetchResult> {
  const components = opts.components ?? SHADCN_COMPONENT_IDS;
  const style = opts.style ?? "new-york";
  const registryBase = opts.registryBase ?? DEFAULT_REGISTRY;
  if (!opts.allowInsecure && !/^https:\/\//i.test(registryBase)) {
    throw new Error(
      `velloo: refusing to fetch shadcn from a non-HTTPS registry (${registryBase}) — a MITM could control the files written. Pass allowInsecure only for a trusted local test server.`,
    );
  }
  const fetchImpl = opts.fetchImpl ?? fetch;
  const fetchedAt = new Date();

  // Fetch everything into memory before touching disk — a network
  // failure on component N must not leave N-1 new files mixed with a
  // stale lockfile from the previous fetch.
  const fetched: { id: string; item: ShadcnRegistryItem }[] = [];
  for (const id of components) {
    const url = `${registryBase}/${style}/${id}.json`;
    const res = await fetchImpl(url);
    if (!res.ok) {
      throw new Error(
        `velloo: failed to fetch shadcn component "${id}" from ${url} (HTTP ${res.status})`,
      );
    }
    const item = (await res.json()) as ShadcnRegistryItem;
    if (!item.files || item.files.length === 0) {
      throw new Error(`velloo: shadcn registry returned no files for "${id}".`);
    }
    fetched.push({ id, item });
  }

  // Reject path traversal BEFORE touching disk: `file.path` is attacker-
  // controlled input (a compromised/MITM registry could return "../../evil" or
  // an absolute path to write outside the destination). Integrity here is still
  // trust-on-first-use — the lock's SHA256s are download-derived, so they catch
  // later drift but don't authenticate the first fetch; HTTPS + this rejection
  // are the first-fetch protections.
  const destRoot = resolve(opts.destination);
  for (const { item } of fetched) {
    for (const file of item.files) {
      const abs = resolve(join(destRoot, file.path));
      if (isAbsolute(file.path) || (abs !== destRoot && !abs.startsWith(destRoot + sep))) {
        throw new Error(
          `velloo: shadcn registry file path "${file.path}" escapes the destination — refusing to write.`,
        );
      }
    }
  }

  await mkdir(opts.destination, { recursive: true });
  const filesWritten: string[] = [];
  const lockComponents: ShadcnUpstreamLock["components"] = {};

  for (const { id, item } of fetched) {
    const fileEntries: { path: string; sha256: string }[] = [];
    for (const file of item.files) {
      // shadcn returns paths like "ui/button.tsx". Mirror them under
      // the destination so `<dest>/ui/button.tsx` exists exactly where
      // a user's app would expect to find it (validated above).
      const targetPath = file.path;
      const abs = resolve(join(destRoot, targetPath));
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, file.content, "utf8");
      filesWritten.push(abs);
      fileEntries.push({ path: targetPath, sha256: hashContent(file.content) });
    }
    lockComponents[id] = {
      files: fileEntries,
      dependencies: item.dependencies ?? [],
      registryDependencies: item.registryDependencies ?? [],
    };
  }

  // The shadcn `cn` helper. Hardcoded because the registry doesn't
  // expose it as a fetch-able entry; the content is stable across
  // shadcn versions (cn = clsx + twMerge). Recorded in the lockfile
  // like any fetched component so verifyCache covers it and the npm
  // dependency aggregation includes what cn() imports.
  const utilsPath = join(opts.destination, "lib", "utils.ts");
  await mkdir(dirname(utilsPath), { recursive: true });
  await writeFile(utilsPath, LIB_UTILS_CONTENT, "utf8");
  filesWritten.push(utilsPath);
  lockComponents.utils = {
    files: [{ path: "lib/utils.ts", sha256: hashContent(LIB_UTILS_CONTENT) }],
    dependencies: ["clsx", "tailwind-merge"],
    registryDependencies: [],
  };

  const lock: ShadcnUpstreamLock = {
    version: opts.version ?? SHADCN_REGISTRY_VERSION,
    fetchedAt: fetchedAt.toISOString(),
    registry: `${registryBase}/${style}`,
    style,
    components: lockComponents,
  };
  const lockPath = join(opts.destination, "shadcn-upstream-lock.json");
  await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");

  return { lock, lockPath, filesWritten };
}

/**
 * Verify a previously-fetched cache against its lock. Returns the
 * list of paths whose on-disk content no longer matches the lock's
 * checksum — empty array = no drift.
 */
export async function verifyCache(
  destination: string,
  lock: ShadcnUpstreamLock,
): Promise<string[]> {
  const { readFile } = await import("node:fs/promises");
  const drifted: string[] = [];
  for (const [, entry] of Object.entries(lock.components)) {
    for (const file of entry.files) {
      const abs = join(destination, file.path);
      try {
        const content = await readFile(abs, "utf8");
        if (hashContent(content) !== file.sha256) drifted.push(file.path);
      } catch {
        drifted.push(file.path);
      }
    }
  }
  return drifted;
}
