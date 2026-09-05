import type { CanvasBundleSpec } from "@velloo/provider";
import type { HostApp } from "@velloo/schema";
import { aliasPairs, hostAppRootFrom } from "./bundle-core.ts";
import {
  buildCanvasBundle,
  type CanvasBundleResult,
  type CanvasComponentDiagnostic,
} from "./canvas-bundle.ts";

const EMPTY: CanvasBundleResult = {
  code: "export function mountScreen() {}\n",
  errors: [],
  usable: false,
  diagnostics: [],
};

interface Entry {
  cached: CanvasBundleResult | null;
  buildPromise: Promise<CanvasBundleResult> | null;
}

/**
 * Cache of framework-native browser bundles, keyed by library and the exact
 * component refs used by a screen. A source edit invalidates every entry and
 * bumps the URL version. Providers without a `canvasBundleSpec` return the
 * inert stub and stay on SSR.
 */
export class CanvasBundler {
  private entries = new Map<string, Entry>();
  private _version = 0;

  constructor(
    private readonly folderRoot: string,
    private readonly hostAppFor: () => HostApp | undefined,
    private readonly specFor: (libraryId: string) => CanvasBundleSpec | undefined,
    private readonly minify = false,
  ) {}

  /** Live entry count — the eviction bound is asserted in tests. */
  get size(): number {
    return this.entries.size;
  }

  /** Cache-bust token bumped on invalidate; the iframe fetches `?v=<version>`. */
  get version(): number {
    return this._version;
  }

  invalidate(): void {
    this.entries.clear();
    this._version++;
  }

  sourceDirs(libraryIds: readonly string[]): string[] {
    const dirs = new Set<string>();
    for (const libraryId of libraryIds) {
      for (const dir of this.specFor(libraryId)?.sourceDirs?.() ?? []) dirs.add(dir);
    }
    return [...dirs];
  }

  diagnostics(libraryId: string, componentIds: readonly string[]): CanvasComponentDiagnostic[] {
    return this.entries.get(cacheKey(libraryId, componentIds))?.cached?.diagnostics ?? [];
  }

  async build(libraryId: string, componentIds: readonly string[]): Promise<CanvasBundleResult> {
    const spec = this.specFor(libraryId);
    if (!spec) return EMPTY;
    const key = cacheKey(libraryId, componentIds);
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { cached: null, buildPromise: null };
      this.entries.set(key, entry);
    }
    if (entry.cached) {
      // Re-insert so `evict` drops the least recently used, not the oldest built.
      this.entries.delete(key);
      this.entries.set(key, entry);
      return entry.cached;
    }
    if (entry.buildPromise) return entry.buildPromise;
    const hostApp = this.hostAppFor();
    const hostRoot = hostAppRootFrom(this.folderRoot, hostApp);
    entry.buildPromise = buildCanvasBundle(
      hostRoot,
      spec,
      componentIds,
      aliasPairs(hostApp),
      this.minify,
    ).then(
      (r) => {
        entry.cached = r;
        entry.buildPromise = null;
        this.evict();
        return r;
      },
      (error: unknown) => {
        // `buildCanvasBundle` is contractually never-throwing, but a bug or an
        // unwritable tmpdir must not park a rejected promise in the cache —
        // every later call would re-throw it and 500 the frame render forever.
        entry.buildPromise = null;
        return {
          ...EMPTY,
          errors: [{ message: error instanceof Error ? error.message : String(error) }],
        };
      },
    );
    return entry.buildPromise;
  }

  /**
   * Bound the cache. Entries are keyed by the exact ref set a screen uses, and
   * `/api/canvas/status`, `/bundle.js` and the `component_status` tool all key
   * off caller-supplied ids — so without a cap a long design session accretes a
   * full `Bun.build` output per distinct ref set and never gives it back.
   */
  private evict(): void {
    while (this.entries.size > MAX_ENTRIES) {
      const oldest = this.entries.keys().next();
      if (oldest.done) return;
      this.entries.delete(oldest.value);
    }
  }
}

/** Roughly a screen's worth of distinct ref sets per library, times a few. */
const MAX_ENTRIES = 48;

function cacheKey(libraryId: string, componentIds: readonly string[]): string {
  return `${libraryId}:${[...new Set(componentIds)].sort().join(",")}`;
}
