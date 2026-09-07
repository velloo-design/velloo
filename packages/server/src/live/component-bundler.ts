import { realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Config, Extension, HostApp } from "@velloo/schema";
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
 * `render:"live"` extensions into browser ESM the canvas iframe loads and
 * mounts into SSR markers. A thin consumer of the shared `bundleComponents`
 * core (bundle-core.ts) — the same primitive the framework-native canvas
 * bundle uses for a whole library. Same cache/invalidate shape; failure
 * stays graceful (live islands).
 *
 * Multi-app folders (monorepos): extensions partition by `extension.app`
 * (a `config.hostApps` key; absent → the default `config.hostApp`), and
 * each partition bundles against ITS app's root/aliases/node_modules —
 * carrying that app's own React copy, which is required (a component
 * closes over its bundled React; mounting it with another app's
 * `createRoot` is the invalid-hook-call hazard). One partition serves its
 * bundle directly (the historical shape); several serve a tiny loader
 * module that imports each app bundle and re-exports a merged `components`
 * registry plus a per-island `runtimes` map the runtime mounts with.
 */

export type { BundleResult } from "./bundle-core.ts";

/** The `hostApp`/`hostApps` slice of config the bundler resolves against. */
export type HostAppsConfig = Pick<Config, "hostApp" | "hostApps">;

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

/** Partition key for the folder-default host app. */
const DEFAULT_APP = "";

/** Group live extensions by the host app they bundle against. */
function partitionByApp(
  live: Record<string, Extension>,
): Map<string, { id: string; importPath: string }[]> {
  const groups = new Map<string, { id: string; importPath: string }[]>();
  for (const [id, ext] of Object.entries(live)) {
    const key = ext.app ?? DEFAULT_APP;
    const list = groups.get(key);
    const entry = { id, importPath: ext.importPath };
    if (list) list.push(entry);
    else groups.set(key, [entry]);
  }
  return groups;
}

/** The host app an extension resolves against, or null for an unknown key. */
function hostAppForExtension(
  config: HostAppsConfig,
  app: string | undefined,
): HostApp | undefined | null {
  if (!app) return config.hostApp;
  return config.hostApps?.[app] ?? null;
}

/**
 * Check whether a live extension's `importPath` resolves from its host app,
 * returning a human warning if not (or null if it resolves). Used by the
 * `add_extension`/`update_extension` mutations to flag a bad path at
 * registration time instead of silently falling back on the canvas.
 */
export function resolveLiveImportWarning(
  folderRoot: string,
  config: HostAppsConfig,
  importPath: string,
  app?: string,
): string | null {
  const hostApp = hostAppForExtension(config, app);
  if (hostApp === null) {
    return (
      `app "${app}" is not a key of config.hostApps (known: ` +
      `${Object.keys(config.hostApps ?? {}).join(", ") || "none"}) — the live island can't ` +
      "bundle until it names a registered app."
    );
  }
  const hostRoot = hostAppRootFrom(folderRoot, hostApp);
  const aliases = aliasPairs(hostApp);
  try {
    resolveImport(importPath, hostRoot, aliases);
    return null;
  } catch (e) {
    const fix = app
      ? `Fix config.hostApps["${app}"].root/aliases or the importPath`
      : "Set config.hostApp.root/aliases or fix the importPath";
    return (
      `live import "${importPath}" did not resolve from host root ${hostRoot} ` +
      `(${e instanceof Error ? e.message : String(e)}). ${fix}; until it resolves the canvas ` +
      "shows the placeholder instead of the real component."
    );
  }
}

const LOADER_MERGE_BODY = `]);
export const components = {};
export const runtimes = {};
for (const g of groups) {
  for (const id in (g.components || {})) {
    components[id] = g.components[id];
    runtimes[id] = g;
  }
}
`;

/**
 * The loader module served when live extensions span several apps: imports
 * each app bundle (same origin, version-pinned), merges the component
 * registries, and exposes a per-island `runtimes` map so each island mounts
 * with its own app's React.
 */
function buildLoaderModule(appKeys: string[], version: number): string {
  const imports = appKeys.map(
    (k) =>
      `  import(${JSON.stringify(`./bundle-app.js?app=${encodeURIComponent(k)}&v=${version}`)}),`,
  );
  return `const groups = await Promise.all([\n${imports.join("\n")}\n${LOADER_MERGE_BODY}`;
}

/**
 * Single-file variant for one-shot consumers (`velloo publish`, the CLI
 * asset server): each app bundle rides inside the loader as a base64 data-URL
 * module import, so the whole multi-app registry ships as ONE .js file with
 * no sibling endpoints. Needs an environment whose CSP admits `data:` module
 * imports (localhost asset server and Chromium screenshots do).
 */
function buildInlineLoaderModule(bundles: BundleResult[]): string {
  const imports = bundles.map(
    (r) =>
      `  import("data:text/javascript;base64,${Buffer.from(r.code, "utf8").toString("base64")}"),`,
  );
  return `const groups = await Promise.all([\n${imports.join("\n")}\n${LOADER_MERGE_BODY}`;
}

/** Resolved path, or the input when it doesn't exist yet. */
function realPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

export class LiveBundler {
  private cached: BundleResult | null = null;
  private cachedApps: Map<string, BundleResult> | null = null;
  private buildPromise: Promise<BundleResult> | null = null;
  private _version = 0;

  constructor(
    private readonly folderRoot: string,
    private readonly hostAppsFor: () => HostAppsConfig,
    private readonly liveExtensionsFor: () => Record<string, Extension>,
    /**
     * Minify the output. Off for the canvas dev preview (readable stacks,
     * faster builds across edit bursts); on for `velloo publish`.
     */
    private readonly minify = false,
    /**
     * Multi-app folders: emit the inline (data-URL) loader instead of one
     * that imports sibling `/bundle-app.js` endpoints. For one-shot
     * consumers that serve a single file (`velloo publish`, the CLI asset
     * server); the dev server keeps the endpoint form.
     */
    private readonly inline = false,
  ) {}

  /** Monotonic counter bumped on every invalidate — used to cache-bust the iframe. */
  get version(): number {
    return this._version;
  }

  /**
   * Directories holding the live components' source files, for the Tailwind
   * JIT to scan so utility classes used *inside* a host component compile.
   * Only dirs inside each host source tree (not node_modules).
   */
  hostSourceDirs(): string[] {
    const config = this.hostAppsFor();
    const dirs = new Set<string>();
    for (const [app, entries] of partitionByApp(this.liveExtensionsFor())) {
      const hostApp = hostAppForExtension(config, app || undefined);
      if (hostApp === null) continue; // unknown app key — surfaced by build()
      const hostRoot = hostAppRootFrom(this.folderRoot, hostApp);
      // `Bun.resolveSync` hands back a realpath, so a host root reached through
      // a symlink (macOS /tmp, a symlinked home, an external volume) never
      // prefix-matches the resolved file — every dir would be dropped and the
      // JIT would silently stop seeing the component's classes. Compare both
      // sides resolved.
      const realRoot = realPath(hostRoot);
      const nodeModules = join(realRoot, "node_modules");
      for (const entry of entries) {
        try {
          const file = realPath(resolveImport(entry.importPath, hostRoot, aliasPairs(hostApp)));
          if (file.startsWith(realRoot) && !file.startsWith(nodeModules)) dirs.add(dirname(file));
        } catch {
          // Unresolvable here too — surfaced by build(), skip for scanning.
        }
      }
    }
    return Array.from(dirs);
  }

  invalidate(): void {
    this.cached = null;
    this.cachedApps = null;
    this.buildPromise = null;
    this._version++;
  }

  /** The root module (`/api/live/bundle.js`): one app's bundle, or the loader. */
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

  /** One app's bundle (`/api/live/bundle-app.js?app=`), for the loader's imports. */
  async buildApp(app: string): Promise<BundleResult> {
    await this.build();
    return (
      this.cachedApps?.get(app) ?? {
        code: EMPTY_MODULE,
        errors: [{ message: `no live bundle for app "${app}"` }],
      }
    );
  }

  private async doBuild(): Promise<BundleResult> {
    const groups = partitionByApp(this.liveExtensionsFor());
    if (groups.size === 0) {
      this.cachedApps = new Map();
      return { code: EMPTY_MODULE, errors: [] };
    }

    const config = this.hostAppsFor();
    const apps = new Map<string, BundleResult>();
    for (const [app, entries] of groups) {
      const hostApp = hostAppForExtension(config, app || undefined);
      if (hostApp === null) {
        apps.set(app, {
          code: EMPTY_MODULE,
          errors: entries.map((e) => ({
            importPath: e.importPath,
            message: `${e.id}: extension names app "${app}" but config.hostApps has no such key.`,
          })),
        });
        continue;
      }
      apps.set(
        app,
        await bundleComponents({
          hostRoot: hostAppRootFrom(this.folderRoot, hostApp),
          entries,
          aliases: aliasPairs(hostApp),
          minify: this.minify,
          cacheKey: `${this.folderRoot}\0${app}`,
        }),
      );
    }
    this.cachedApps = apps;

    const errors = [...apps.values()].flatMap((r) => r.errors);
    if (apps.size === 1) {
      // Single host app — serve its bundle directly (the historical shape;
      // the runtime's `mod.React`/`mod.createRoot` path keeps working).
      const only = [...apps.values()][0] as BundleResult;
      return { code: only.code, errors };
    }
    const code = this.inline
      ? buildInlineLoaderModule([...apps.values()])
      : buildLoaderModule([...apps.keys()], this._version);
    return { code, errors };
  }
}
