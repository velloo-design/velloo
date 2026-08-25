import { dirname, join } from "node:path";
import type { Extension, HostApp } from "@velloo/schema";
import {
  aliasPairs,
  type BundleResult,
  bundleComponents,
  EMPTY_MODULE,
  hostAppRootFrom,
  resolveImport,
} from "./bundle-core.ts";

/**
 * Live-island bundler. Twin of `TailwindJit`: compiles a folder's
 * `render:"live"` extensions into one browser ESM module the canvas iframe
 * loads and mounts into SSR markers. Now a thin consumer of the shared
 * `bundleComponents` core (bundle-core.ts) — the same primitive the
 * framework-native canvas bundle uses for a whole library. Same
 * cache/invalidate shape; failure stays graceful (live islands).
 */

export type { BundleError, BundleResult } from "./bundle-core.ts";

/** Pick the `render:"live"` extensions from a folder's extension map. */
export function liveExtensions(
  extensions: Record<string, Extension> | undefined,
): Record<string, Extension> {
  const out: Record<string, Extension> = {};
  for (const [id, ext] of Object.entries(extensions ?? {})) {
    if (ext.render === "live") out[id] = ext;
  }
  return out;
}

/**
 * Check whether a live extension's `importPath` resolves from the host app,
 * returning a human warning if not (or null if it resolves). Used by the
 * `add_extension`/`update_extension` mutations to flag a bad path at
 * registration time instead of silently falling back on the canvas.
 */
export function resolveLiveImportWarning(
  folderRoot: string,
  hostApp: HostApp | undefined,
  importPath: string,
): string | null {
  const hostRoot = hostAppRootFrom(folderRoot, hostApp);
  const aliases = aliasPairs(hostApp);
  try {
    resolveImport(importPath, hostRoot, aliases);
    return null;
  } catch (e) {
    return (
      `live import "${importPath}" did not resolve from host root ${hostRoot} ` +
      `(${e instanceof Error ? e.message : String(e)}). Set config.hostApp.root/aliases or fix ` +
      "the importPath; until it resolves the canvas shows the placeholder instead of the real component."
    );
  }
}

export class LiveBundler {
  private cached: BundleResult | null = null;
  private buildPromise: Promise<BundleResult> | null = null;
  private _version = 0;

  constructor(
    private readonly folderRoot: string,
    private readonly hostAppFor: () => HostApp | undefined,
    private readonly liveExtensionsFor: () => Record<string, Extension>,
    /**
     * Minify the output. Off for the canvas dev preview (readable stacks,
     * faster builds across edit bursts); on for `velloo publish`.
     */
    private readonly minify = false,
  ) {}

  /** Monotonic counter bumped on every invalidate — used to cache-bust the iframe. */
  get version(): number {
    return this._version;
  }

  /**
   * Directories holding the live components' source files, for the Tailwind
   * JIT to scan so utility classes used *inside* a host component compile.
   * Only dirs inside the host source tree (not node_modules).
   */
  hostSourceDirs(): string[] {
    const hostApp = this.hostAppFor();
    const hostRoot = hostAppRootFrom(this.folderRoot, hostApp);
    const aliases = aliasPairs(hostApp);
    const nodeModules = join(hostRoot, "node_modules");
    const dirs = new Set<string>();
    for (const ext of Object.values(this.liveExtensionsFor())) {
      try {
        const file = resolveImport(ext.importPath, hostRoot, aliases);
        if (file.startsWith(hostRoot) && !file.startsWith(nodeModules)) dirs.add(dirname(file));
      } catch {
        // Unresolvable here too — surfaced by build(), skip for scanning.
      }
    }
    return Array.from(dirs);
  }

  invalidate(): void {
    this.cached = null;
    this.buildPromise = null;
    this._version++;
  }

  async build(): Promise<BundleResult> {
    if (this.cached) return this.cached;
    if (this.buildPromise) return this.buildPromise;
    this.buildPromise = this.doBuild()
      .then((result) => {
        this.cached = result;
        this.buildPromise = null;
        return result;
      })
      .catch((err) => {
        this.buildPromise = null;
        const result: BundleResult = {
          code: EMPTY_MODULE,
          errors: [{ message: err instanceof Error ? err.message : String(err) }],
        };
        this.cached = result;
        return result;
      });
    return this.buildPromise;
  }

  private async doBuild(): Promise<BundleResult> {
    const live = this.liveExtensionsFor();
    const entries = Object.entries(live).map(([id, ext]) => ({ id, importPath: ext.importPath }));
    const hostApp = this.hostAppFor();
    return bundleComponents({
      hostRoot: hostAppRootFrom(this.folderRoot, hostApp),
      entries,
      aliases: aliasPairs(hostApp),
      minify: this.minify,
      cacheKey: this.folderRoot,
    });
  }
}
