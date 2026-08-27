import type { CanvasBundleSpec } from "@velloo/provider";
import type { HostApp } from "@velloo/schema";
import { type BundleResult, hostAppRootFrom } from "./bundle-core.ts";
import { buildCanvasBundle } from "./canvas-bundle.ts";

const EMPTY: BundleResult = { code: "export function mountScreen() {}\n", errors: [] };

interface Entry {
  cached: BundleResult | null;
  buildPromise: Promise<BundleResult> | null;
}

/**
 * Per-library cache of the framework-native canvas bundle (#18) — the installed
 * components from the host app's `node_modules`, built once per library and
 * reused across renders, version-bumped on invalidate so the iframe re-fetches.
 * Mirrors `LiveBundler`. Inert (returns the empty stub) for a library whose
 * adapter declares no `canvasBundleSpec` — i.e. shadcn / no-lib, or a
 * velloo-only MUI folder with nothing installed to bundle: the render path then
 * stays on SSR. Keyed per library so a non-default-library screen in a
 * multi-library folder client-mounts too.
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

  /** Cache-bust token bumped on invalidate; the iframe fetches `?v=<version>`. */
  get version(): number {
    return this._version;
  }

  invalidate(): void {
    this.entries.clear();
    this._version++;
  }

  async build(libraryId: string): Promise<BundleResult> {
    const spec = this.specFor(libraryId);
    if (!spec) return EMPTY;
    let entry = this.entries.get(libraryId);
    if (!entry) {
      entry = { cached: null, buildPromise: null };
      this.entries.set(libraryId, entry);
    }
    if (entry.cached) return entry.cached;
    if (entry.buildPromise) return entry.buildPromise;
    const hostRoot = hostAppRootFrom(this.folderRoot, this.hostAppFor());
    entry.buildPromise = buildCanvasBundle(hostRoot, spec, this.minify).then((r) => {
      entry.cached = r;
      entry.buildPromise = null;
      return r;
    });
    return entry.buildPromise;
  }
}
