import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { Extension, HostApp } from "@velloo/schema";
import type { BunPlugin } from "bun";

/**
 * Live-island bundler. Twin of `TailwindJit`: compiles a folder's
 * `render:"live"` extensions into one browser ESM module the canvas
 * iframe loads and mounts into SSR markers. Same cache/invalidate shape
 * — a burst of edits pays the (expensive) `Bun.build` once.
 *
 * The bundle is built from the HOST app's own `node_modules` (the user's
 * exact recharts + React), so a live chart renders byte-for-byte what
 * their app ships. The host React is bundled in (the island runs in a
 * fresh document with no React on `window`); the runtime consumes
 * `createRoot` from the bundle so there's a single React copy.
 *
 * Failure is graceful: a build error (or an unresolvable component)
 * returns an empty/partial module + structured errors. The marker keeps
 * its SSR placeholder skeleton, so the worst case is "no worse than
 * today". See docs/decisions.md (live islands).
 */

export interface BundleError {
  /** The component importPath that failed to resolve, when attributable. */
  importPath?: string;
  message: string;
}

export interface BundleResult {
  /** Browser ESM exporting `components`, `createRoot`, `React`, `ErrorBoundary`. */
  code: string;
  errors: BundleError[];
}

const EMPTY_MODULE = "export const components = {};\n";

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
    const aliased = applyAlias(importPath, aliases);
    Bun.resolveSync(aliased ? join(hostRoot, aliased) : importPath, hostRoot);
    return null;
  } catch (e) {
    return (
      `live import "${importPath}" did not resolve from host root ${hostRoot} ` +
      `(${e instanceof Error ? e.message : String(e)}). Set config.hostApp.root/aliases or fix ` +
      "the importPath; until it resolves the canvas shows the placeholder instead of the real component."
    );
  }
}

/** Resolve the host app root: explicit config, else the design folder's parent. */
function hostAppRootFrom(folderRoot: string, hostApp: HostApp | undefined): string {
  if (!hostApp?.root) return resolve(folderRoot, "..");
  return isAbsolute(hostApp.root) ? hostApp.root : resolve(folderRoot, hostApp.root);
}

/** Normalize a tsconfig-style alias map (`{ "@/*": "src/*" }`) to prefix pairs. */
function aliasPairs(hostApp: HostApp | undefined): { from: string; to: string }[] {
  const raw = hostApp?.aliases ?? { "@/*": "*" };
  return Object.entries(raw).map(([pattern, target]) => ({
    from: pattern.replace(/\*$/, ""),
    to: target.replace(/\*$/, ""),
  }));
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
     * faster builds across edit bursts); on for `velloo publish`, whose
     * bundle ships in a public share where transfer size matters.
     */
    private readonly minify = false,
  ) {}

  /** Monotonic counter bumped on every invalidate — used to cache-bust the iframe. */
  get version(): number {
    return this._version;
  }

  /** Last build's errors (null until first build). */
  lastError(): BundleError[] | null {
    return this.cached?.errors ?? null;
  }

  /**
   * Directories holding the live components' source files, for the Tailwind
   * JIT to scan so utility classes used *inside* a host component compile.
   * Only dirs inside the host source tree (not node_modules) — an npm-package
   * importPath ships its own CSS and isn't scanned. Best-effort: unresolvable
   * importPaths are skipped silently (the build path reports them).
   */
  hostSourceDirs(): string[] {
    const hostApp = this.hostAppFor();
    const hostRoot = hostAppRootFrom(this.folderRoot, hostApp);
    const aliases = aliasPairs(hostApp);
    const nodeModules = join(hostRoot, "node_modules");
    const dirs = new Set<string>();
    for (const ext of Object.values(this.liveExtensionsFor())) {
      try {
        const file = this.resolveImport(ext.importPath, hostRoot, aliases);
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
        // Never throw out of the bundler — a build crash degrades to
        // all-fallback with a surfaced error, same as a build failure.
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
    const ids = Object.keys(live);
    if (ids.length === 0) return { code: EMPTY_MODULE, errors: [] };

    const hostApp = this.hostAppFor();
    const hostRoot = hostAppRootFrom(this.folderRoot, hostApp);
    const aliases = aliasPairs(hostApp);

    // React/createRoot come from the host so the bundled components link
    // against the app's exact React copy. Missing react-dom/client ⇒ the
    // app is on React <18 (or RSC-only) and can't client-mount.
    let reactPath: string;
    let reactDomClientPath: string;
    try {
      reactPath = Bun.resolveSync("react", hostRoot);
      reactDomClientPath = Bun.resolveSync("react-dom/client", hostRoot);
    } catch {
      return {
        code: EMPTY_MODULE,
        errors: [
          {
            message:
              "Live preview needs the host app's React 18+ (could not resolve `react`/`react-dom/client` " +
              `from ${hostRoot}). Set config.hostApp.root if the app lives elsewhere.`,
          },
        ],
      };
    }

    const errors: BundleError[] = [];
    const resolved: { id: string; path: string }[] = [];
    for (const id of ids) {
      const ext = live[id];
      if (!ext) continue;
      try {
        resolved.push({ id, path: this.resolveImport(ext.importPath, hostRoot, aliases) });
      } catch (err) {
        errors.push({
          importPath: ext.importPath,
          message: `${id}: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }
    if (resolved.length === 0) return { code: EMPTY_MODULE, errors };

    const entrySource = buildEntrySource(reactPath, reactDomClientPath, resolved);
    const entryPath = join(
      tmpdir(),
      "velloo-live",
      Bun.hash(this.folderRoot).toString(16),
      "entry.tsx",
    );
    await mkdir(join(tmpdir(), "velloo-live", Bun.hash(this.folderRoot).toString(16)), {
      recursive: true,
    });
    await writeFile(entryPath, entrySource, "utf8");

    const result = await Bun.build({
      entrypoints: [entryPath],
      target: "browser",
      format: "esm",
      minify: this.minify,
      sourcemap: "none",
      define: { "process.env.NODE_ENV": '"production"' },
      plugins: [aliasPlugin(hostRoot, aliases)],
    });

    if (!result.success) {
      for (const log of result.logs) {
        errors.push({ message: typeof log === "string" ? log : log.message });
      }
      return { code: EMPTY_MODULE, errors };
    }

    const output = result.outputs[0];
    if (!output) {
      errors.push({ message: "Bun.build produced no output artifact." });
      return { code: EMPTY_MODULE, errors };
    }
    return { code: await output.text(), errors };
  }

  /**
   * Resolve a live extension's `importPath` to an absolute module path
   * against the host app: apply tsconfig aliases first, then Bun's normal
   * resolution (bare specifiers, extensions). Throws if unresolvable.
   */
  private resolveImport(
    importPath: string,
    hostRoot: string,
    aliases: { from: string; to: string }[],
  ): string {
    const aliased = applyAlias(importPath, aliases);
    // Aliased → host-root-relative; bare/relative resolve straight from the
    // host root (npm packages from its node_modules, "./" against the root).
    return Bun.resolveSync(aliased ? join(hostRoot, aliased) : importPath, hostRoot);
  }
}

/** Rewrite an aliased specifier to a host-root-relative path, or null if no alias matches. */
function applyAlias(spec: string, aliases: { from: string; to: string }[]): string | null {
  for (const { from, to } of aliases) {
    if (from && spec.startsWith(from)) return to + spec.slice(from.length);
  }
  return null;
}

/** Build plugin that resolves `@/`-style aliases inside the component graph against the host root. */
function aliasPlugin(hostRoot: string, aliases: { from: string; to: string }[]): BunPlugin {
  const prefixes = aliases.map((a) => a.from).filter(Boolean);
  return {
    name: "velloo-host-alias",
    setup(build) {
      if (prefixes.length === 0) return;
      const filter = new RegExp(`^(${prefixes.map(escapeRegExp).join("|")})`);
      build.onResolve({ filter }, (args) => {
        const aliased = applyAlias(args.path, aliases);
        if (!aliased) return undefined;
        try {
          return { path: Bun.resolveSync(join(hostRoot, aliased), hostRoot) };
        } catch {
          return undefined;
        }
      });
    },
  };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Generate the bundle entrypoint: import each live component (namespace
 * import, so a named-by-id or default export both work), import the host
 * React + createRoot, and re-export a registry + a tiny ErrorBoundary the
 * runtime wraps each mount in.
 */
function buildEntrySource(
  reactPath: string,
  reactDomClientPath: string,
  components: { id: string; path: string }[],
): string {
  const imports = components
    .map((c, i) => `import * as __m${i} from ${JSON.stringify(c.path)};`)
    .join("\n");
  const registry = components
    .map((c, i) => `  ${JSON.stringify(c.id)}: pick(__m${i}, ${JSON.stringify(c.id)}),`)
    .join("\n");
  return `import * as React from ${JSON.stringify(reactPath)};
import { createRoot } from ${JSON.stringify(reactDomClientPath)};
${imports}

function pick(mod, id) {
  return (mod && mod[id]) || (mod && mod.default) || mod;
}

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error) {
    if (this.props.onError) this.props.onError(error);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export const components = {
${registry}
};
export { React, createRoot, ErrorBoundary };
`;
}
