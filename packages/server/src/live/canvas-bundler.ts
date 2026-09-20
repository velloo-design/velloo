import { resolve } from "node:path";
import type { CanvasBundleSpec, StyleChannelKind } from "@velloo/provider";
import { type HostApp, parseRepoKey } from "@velloo/schema";
import type { RepoComponents } from "../repo/catalog.ts";
import { aliasPairs, hostAppRootFrom } from "./bundle-core.ts";
import {
  buildCanvasBundle,
  type CanvasBundleResult,
  type CanvasComponentDiagnostic,
  type RepoBundleInput,
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

export interface CanvasBundlerOptions {
  /** The folder's repository components: resolves `repo:` refs, previews and recipes. */
  repo?: RepoComponents | undefined;
  /** The style channel a library's screens render with (the `none` provider's CSS choice). */
  channelFor?: ((libraryId: string) => StyleChannelKind | undefined) | undefined;
}

/**
 * Cache of framework-native browser bundles, keyed by library and the exact
 * component refs used by a screen. A source edit invalidates only the bundles
 * that compiled the edited file and bumps the URL version. Providers without a
 * `canvasBundleSpec` return the inert stub and stay on SSR — unless the screen
 * uses repository components, which always need the browser mount.
 */
export class CanvasBundler {
  private entries = new Map<string, Entry>();
  private runtime = new Map<string, CanvasComponentDiagnostic[]>();
  private _version = 0;

  constructor(
    private readonly folderRoot: string,
    private readonly hostAppFor: () => HostApp | undefined,
    private readonly specFor: (libraryId: string) => CanvasBundleSpec | undefined,
    private readonly minify = false,
    private readonly opts: CanvasBundlerOptions = {},
  ) {}

  /** Live entry count — the eviction bound is asserted in tests. */
  get size(): number {
    return this.entries.size;
  }

  /** Cache-bust token bumped on invalidate; the iframe fetches `?v=<version>`. */
  get version(): number {
    return this._version;
  }

  /**
   * Drop cached bundles. With `changed` files, only bundles that compiled one
   * of them go — editing one component leaves every unrelated screen's bundle
   * warm. Without, everything goes.
   */
  invalidate(changed?: readonly string[]): void {
    this.runtime.clear();
    if (!changed || changed.length === 0) {
      this.entries.clear();
      this._version++;
      return;
    }
    // Both sides normalized: a watcher path and a bundler input can spell the
    // same file differently (separators, a relative prefix).
    const touched = new Set(changed.map((file) => resolve(file)));
    let dropped = false;
    for (const [key, entry] of this.entries) {
      const inputs = entry.cached?.inputs;
      if (!inputs || inputs.some((input) => touched.has(resolve(input)))) {
        this.entries.delete(key);
        dropped = true;
      }
    }
    if (dropped) this._version++;
  }

  sourceDirs(libraryIds: readonly string[]): string[] {
    const dirs = new Set<string>();
    for (const libraryId of libraryIds) {
      for (const dir of this.specFor(libraryId)?.sourceDirs?.() ?? []) dirs.add(dir);
    }
    for (const dir of this.opts.repo?.watchDirs() ?? []) dirs.add(dir);
    return [...dirs];
  }

  diagnostics(libraryId: string, componentIds: readonly string[]): CanvasComponentDiagnostic[] {
    return this.entries.get(this.cacheKey(libraryId, componentIds))?.cached?.diagnostics ?? [];
  }

  /**
   * What a mounted frame found at runtime — a component that threw, a missing
   * provider, a stylesheet that never loaded — reported by the iframe for the
   * bundle URL it mounted. Only well-formed entries are kept: the page is the
   * user's own code on localhost, but still not trusted to shape our state.
   */
  recordRuntime(bundleUrl: string, items: unknown): void {
    const refs = new URL(bundleUrl, "http://velloo.local").searchParams.get("refs");
    if (!refs || !Array.isArray(items)) return;
    const clean: CanvasComponentDiagnostic[] = [];
    for (const item of items.slice(0, 500)) {
      if (!item || typeof item !== "object") continue;
      const { id, status, code, note, name, remedy } = item as Record<string, unknown>;
      if (typeof id !== "string" || typeof status !== "string") continue;
      clean.push({
        id: id.slice(0, 300),
        status: status.slice(0, 20) as CanvasComponentDiagnostic["status"],
        ...(typeof code === "string"
          ? { code: code.slice(0, 40) as NonNullable<CanvasComponentDiagnostic["code"]> }
          : {}),
        ...(typeof note === "string" ? { note: note.slice(0, 600) } : {}),
        ...(typeof name === "string" ? { name: name.slice(0, 120) } : {}),
        ...(typeof remedy === "string" ? { remedy: remedy.slice(0, 400) } : {}),
      });
    }
    this.runtime.set(refsKey(refs.split(",")), clean);
    while (this.runtime.size > MAX_ENTRIES) {
      const oldest = this.runtime.keys().next();
      if (oldest.done) break;
      this.runtime.delete(oldest.value);
    }
  }

  /** The latest runtime report for a screen's refs, if a frame has mounted it. */
  runtimeDiagnostics(componentIds: readonly string[]): CanvasComponentDiagnostic[] | undefined {
    return this.runtime.get(refsKey(componentIds));
  }

  /** Whether this library can mount a screen with these refs at all. */
  canMount(libraryId: string, componentIds: readonly string[]): boolean {
    const spec = this.specFor(libraryId);
    const hasRepo =
      this.opts.repo !== undefined && componentIds.some((id) => id.startsWith("repo:"));
    if (hasRepo) return true;
    return spec !== undefined && !spec.onlyWithRepository;
  }

  async build(libraryId: string, componentIds: readonly string[]): Promise<CanvasBundleResult> {
    if (!this.canMount(libraryId, componentIds)) return EMPTY;
    const spec = this.specFor(libraryId);
    const key = this.cacheKey(libraryId, componentIds);
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
    const repo = this.repoInput(componentIds);
    const primary = repo ? repo.host(repo.primaryApp) : undefined;
    const hostApp = this.hostAppFor();
    const hostRoot = primary?.hostRoot ?? hostAppRootFrom(this.folderRoot, hostApp);
    const channel = this.opts.channelFor?.(libraryId);
    const scopedSpec: CanvasBundleSpec | undefined = spec
      ? { ...spec, components: (ids) => spec.components(ids, { channel }) }
      : undefined;
    const current = entry;
    current.buildPromise = buildCanvasBundle(
      hostRoot,
      scopedSpec,
      componentIds,
      primary?.aliases ?? aliasPairs(hostApp, hostRoot),
      this.minify,
      repo,
    ).then(
      (r) => {
        current.cached = r;
        current.buildPromise = null;
        this.evict();
        return r;
      },
      (error: unknown) => {
        // `buildCanvasBundle` is contractually never-throwing, but a bug or an
        // unwritable tmpdir must not park a rejected promise in the cache —
        // every later call would re-throw it and 500 the frame render forever.
        current.buildPromise = null;
        return {
          ...EMPTY,
          errors: [{ message: error instanceof Error ? error.message : String(error) }],
        };
      },
    );
    return current.buildPromise;
  }

  /**
   * The repository side of a build: the app most of the screen's components
   * come from mounts it (its React, its preview entry); the rest resolve
   * against their own apps.
   */
  private repoInput(componentIds: readonly string[]): RepoBundleInput | undefined {
    const repo = this.opts.repo;
    if (!repo) return undefined;
    const apps = componentIds
      .filter((id) => id.startsWith("repo:"))
      .map((id) => parseRepoKey(id)?.app);
    if (apps.length === 0) return undefined;
    const counts = new Map<string | undefined, number>();
    for (const app of apps) counts.set(app, (counts.get(app) ?? 0) + 1);
    const primaryApp = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    return {
      host: (app) => repo.host(app),
      preview: (app) => repo.preview(app),
      recipes: repo.recipes(primaryApp),
      primaryApp,
    };
  }

  private cacheKey(libraryId: string, componentIds: readonly string[]): string {
    const channel = this.opts.channelFor?.(libraryId) ?? "";
    return `${libraryId}:${channel}:${[...new Set(componentIds)].sort().join(",")}`;
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

function refsKey(ids: readonly string[]): string {
  return [...new Set(ids)].sort().join(",");
}
