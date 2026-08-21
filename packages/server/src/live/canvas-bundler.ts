import type { CanvasBundleSpec } from "@velloo/provider";
import type { HostApp } from "@velloo/schema";
import { type BundleResult, hostAppRootFrom } from "./bundle-core.ts";
import { buildCanvasBundle } from "./canvas-bundle.ts";

const EMPTY: BundleResult = { code: "export function mountScreen() {}\n", errors: [] };

/**
 * Per-folder cache of the framework-native canvas bundle (#18) — the installed
 * components from the host app's `node_modules`, built once and reused across
 * renders, version-bumped on invalidate so the iframe re-fetches. Mirrors
 * `LiveBundler`. Inert (returns the empty stub) when the active adapter declares
 * no `canvasBundleSpec` — i.e. shadcn / no-lib, or a velloo-only MUI folder with
 * nothing installed to bundle: the render path then stays on SSR.
 */
export class CanvasBundler {
  private cached: BundleResult | null = null;
  private buildPromise: Promise<BundleResult> | null = null;
  private _version = 0;

  constructor(
    private readonly folderRoot: string,
    private readonly hostAppFor: () => HostApp | undefined,
    private readonly specFor: () => CanvasBundleSpec | undefined,
    private readonly minify = false,
  ) {}

  /** Cache-bust token bumped on invalidate; the iframe fetches `?v=<version>`. */
  get version(): number {
    return this._version;
  }

  /** Whether the active adapter wants client-rendered installed components. */
  get available(): boolean {
    return this.specFor() !== undefined;
  }

  /** Structured build errors from the last build, if any (e.g. framework not installed). */
  lastError(): BundleResult["errors"] | null {
    return this.cached?.errors ?? null;
  }

  invalidate(): void {
    this.cached = null;
    this.buildPromise = null;
    this._version++;
  }

  async build(): Promise<BundleResult> {
    const spec = this.specFor();
    if (!spec) return EMPTY;
    if (this.cached) return this.cached;
    if (this.buildPromise) return this.buildPromise;
    const hostRoot = hostAppRootFrom(this.folderRoot, this.hostAppFor());
    this.buildPromise = buildCanvasBundle(hostRoot, spec, this.minify).then((r) => {
      this.cached = r;
      this.buildPromise = null;
      return r;
    });
    return this.buildPromise;
  }
}
