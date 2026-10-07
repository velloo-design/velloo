import { existsSync, readFileSync, realpathSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { HostApp } from "@velloo/schema";
import type { BunPlugin } from "bun";
import { localDesignOf, resolveAppPath } from "../project-location.ts";

/**
 * The reusable component-bundling primitive. Given a host root, a set of
 * `{ id, importPath }` entries, and alias rules, it `Bun.build`s one browser
 * ESM module exporting a `{ id → Component }` registry plus the host's React /
 * createRoot / an ErrorBoundary. The components link against the HOST app's
 * exact React copy (the bundle carries its own React) — which is precisely how
 * a non-velloo-React framework (MUI from the install) renders in the canvas
 * without the dual-React hazard that blocks server-side renderToString.
 *
 * Two consumers: the live-island bundler (`render:"live"` extensions) and the
 * framework-native canvas bundle (an adapter's whole catalog). Failure is
 * graceful — unresolved entries and build errors return a partial/empty module
 * plus structured errors; nothing throws.
 */

/**
 * `Bun.build` for sources the host repo supplies. Bun runs a macro
 * (`import … with { type: "macro" }`) at bundle time, in this process, for any
 * file outside node_modules — so bundling a cloned repo's components would run
 * its code on the daemon the moment the canvas opens. `macros: false` (the
 * bundler's `--no-macros`; absent from the typings, hence the spread) turns such
 * an import into a build error, which the callers already degrade into a
 * per-component fallback.
 */
export function buildHostSource(config: Bun.BuildConfig): Promise<Bun.BuildOutput> {
  return Bun.build({ ...config, ...NO_MACROS });
}
const NO_MACROS = { macros: false };

export interface BundleError {
  /** The importPath that failed to resolve, when attributable. */
  importPath?: string;
  message: string;
}

export interface BundleResult {
  /** Browser ESM exporting `components`, `createRoot`, `React`, `ErrorBoundary`. */
  code: string;
  errors: BundleError[];
}

export interface BundleEntry {
  id: string;
  importPath: string;
}

export const EMPTY_MODULE = "export const components = {};\n";

/**
 * `process` for a browser bundle. `define` only rewrites the exact
 * `process.env.NODE_ENV` it is given, and app code reads other keys —
 * `next/link` reads several while its module loads, which throws a
 * ReferenceError that takes the whole mount down. A banner runs before any
 * bundled module body, and carries no values from this machine's environment.
 */
export const PROCESS_SHIM =
  'globalThis.process ??= { env: { NODE_ENV: "production" }, browser: true, platform: "browser", version: "", versions: {}, argv: [], cwd: function () { return "/"; } };\n';

/**
 * One spelling for a filesystem path, so a watcher event and a build input
 * compare equal. A bundler can hand back `/D:/a/app.tsx` or `d:\a\app.tsx`
 * for the file a watcher calls `D:\a\app.tsx`, and bundle inputs are
 * canonical (`resolveModule`) while a watcher spells files from the host root
 * as configured — through a symlink (macOS's `/var`, a symlinked checkout) or
 * a Windows 8.3 short name (`RUNNER~1`). None of those are equal as strings,
 * which silently turns selective invalidation into "nothing ever changed".
 */
export function pathKey(path: string): string {
  const windows = process.platform === "win32";
  // Separators first, then the stray leading one: a bundler hands back
  // `/C:/Users/…` or `\C:\Users\…` for a file a watcher calls `C:\Users\…`,
  // and read naively that leading separator means "root of the current drive",
  // so a checkout on D: turns it into `D:\C:\Users\…` — a path that matches
  // nothing, which reads as "no bundle was affected" rather than as an error.
  // Backslashes are only separators on Windows; elsewhere they are filename
  // characters and must survive.
  const slashed = windows ? path.replaceAll("\\", "/") : path;
  const resolved = resolve(slashed.replace(/^\/+(?=[A-Za-z]:)/, ""));
  if (!windows) return canonicalSpelling(resolved);
  // `D:/C:/Users/…`: a bundler names its inputs relative to the working
  // directory, and a file on another drive cannot be expressed that way — the
  // climb it emits (`../../C:/Users/…`) resolves into the wrong drive with the
  // right path hanging off it. A colon is illegal in a Windows filename, so a
  // drive letter anywhere but the start can only be where the real path began.
  const drive = resolved.replaceAll("\\", "/").replace(/^.*\/(?=[A-Za-z]:\/)/, "");
  return canonicalSpelling(drive).replaceAll("\\", "/").toLowerCase();
}

const canonicalDirs = new Map<string, string>();

/**
 * The path with its directory canonicalized, cached per directory so keying
 * every input of every bundle stays a map lookup. The file itself is not
 * realpathed: an edit event can name a file that was just deleted, and the
 * nearest existing ancestor still gives the rest of the path its canonical
 * spelling.
 */
function canonicalSpelling(path: string): string {
  const dir = dirname(path);
  return dir === path ? path : join(canonicalDir(dir), basename(path));
}

function canonicalDir(dir: string): string {
  const cached = canonicalDirs.get(dir);
  if (cached !== undefined) return cached;
  try {
    const real = realpathSync.native(dir);
    canonicalDirs.set(dir, real);
    return real;
  } catch {
    // Not cached: a directory that doesn't exist yet may be created later.
    return canonicalSpelling(dir);
  }
}

/** Resolve the host app root: explicit config, else the design folder's parent. */
export function hostAppRootFrom(folderRoot: string, hostApp: HostApp | undefined): string {
  if (!hostApp?.root) return localDesignOf(folderRoot)?.appRoot ?? resolve(folderRoot, "..");
  return resolveAppPath(folderRoot, hostApp.root);
}

/**
 * Normalize a tsconfig-style alias map (`{ "@/*": "src/*" }`) to prefix pairs.
 * With a host root, the app's own tsconfig `paths` fill in and correct them:
 * the recorded map is a guess made at `init` from where components were found,
 * and an app whose alias points elsewhere (`"@/*": ["./*"]`, no `src/`) would
 * otherwise resolve nothing — its components silently missing from the canvas.
 */
export function aliasPairs(
  hostApp: HostApp | undefined,
  hostRoot?: string,
): { from: string; to: string }[] {
  const pairs = Object.entries(hostApp?.aliases ?? { "@/*": "*" }).map(([pattern, target]) => ({
    from: pattern.replace(/\*$/, ""),
    to: target.replace(/\*$/, ""),
  }));
  if (hostRoot === undefined) return pairs;
  const declared = tsconfigAliases(hostRoot);
  const kept = pairs.filter(
    (pair) =>
      !declared.some((other) => other.from === pair.from) &&
      (pair.to === "" || existsSync(join(hostRoot, pair.to))),
  );
  return [...kept, ...declared];
}

/** `compilerOptions.paths` (with `baseUrl`) from the app's tsconfig or jsconfig. */
export function tsconfigAliases(hostRoot: string): { from: string; to: string }[] {
  for (const name of ["tsconfig.json", "jsconfig.json"]) {
    const file = join(hostRoot, name);
    if (!existsSync(file)) continue;
    try {
      const config = parseJsonc(readFileSync(file, "utf8")) as {
        compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> };
      };
      const base = (config.compilerOptions?.baseUrl ?? ".").replace(/^\.\//, "").replace(/\/$/, "");
      const out: { from: string; to: string }[] = [];
      for (const [pattern, targets] of Object.entries(config.compilerOptions?.paths ?? {})) {
        const target = targets[0];
        if (!target) continue;
        const to = `${base && base !== "." ? `${base}/` : ""}${target.replace(/^\.\//, "").replace(/\*$/, "")}`;
        out.push({ from: pattern.replace(/\*$/, ""), to });
      }
      if (out.length > 0) return out;
    } catch {
      // A tsconfig we can't read is no worse than none.
    }
  }
  return [];
}

/** Comments and trailing commas are legal in a tsconfig; JSON.parse doesn't take them. */
function parseJsonc(text: string): unknown {
  const stripped = text
    .replace(/\\"|"(?:\\"|[^"])*"|(\/\/[^\n]*|\/\*[\s\S]*?\*\/)/g, (match, comment) =>
      comment ? " " : match,
    )
    .replace(/,\s*([}\]])/g, "$1");
  return JSON.parse(stripped);
}

/** Rewrite an aliased specifier to a host-root-relative path, or null if no alias matches. */
function applyAlias(spec: string, aliases: { from: string; to: string }[]): string | null {
  for (const { from, to } of aliases) {
    if (from && spec.startsWith(from)) return to + spec.slice(from.length);
  }
  return null;
}

/** The file's canonical path, or the input when it doesn't exist (yet). */
export function canonicalPath(path: string): string {
  try {
    // native: also expands Windows 8.3 short names, as Bun.resolveSync does.
    return realpathSync.native(path);
  } catch {
    return path;
  }
}

/**
 * `Bun.resolveSync`, always canonical. Bun usually hands back a realpath, but
 * not reliably: resolving from a root reached through a symlink (macOS's
 * `/var` → `/private/var`, a symlinked checkout) it sometimes returns the
 * symlinked spelling instead, and the bundler can keep it, while a relative
 * import of the same file from elsewhere (the preview entry's) resolves
 * canonically. `Bun.build` keys modules by path, so the file is bundled twice
 * — two `createContext` calls, and the preview entry's provider no longer
 * reaches the component it wraps. Every path handed to a bundle as a module
 * goes through here.
 */
export function resolveModule(specifier: string, from: string): string {
  return canonicalPath(browserBuild(specifier, Bun.resolveSync(specifier, from)));
}

/** A specifier that names a package and nothing inside it. */
const PACKAGE_ROOT = /^(?:@[^/\\:\s]+\/)?[^./@\\:\s][^/\\:\s]*$/;

/**
 * The file a browser bundle uses for a package that predates `exports`.
 *
 * `Bun.resolveSync` answers as the runtime does and returns the package's
 * `main`. `Bun.build` prefers `module` — so a package that ships a CommonJS and
 * an ES build is one file to this resolver and another to every bare import of
 * it in the app's own code. Both halves of that are wrong: the package is
 * bundled twice, and the copy handed in by path is the CommonJS one, which
 * cannot be tree-shaken. `@tabler/icons-react` was 4 MB of a 6.4 MB screen
 * bundle for two icons, and `lucide-react` is the same shape.
 *
 * Only `module`. A package with `exports` is left alone, since there Bun
 * already picks the ES build. So is a string `browser` field: a fresh
 * `Bun.build` would rank it above `module`, but not in this process — once the
 * runtime resolver has read a manifest (which the line above just did) the
 * bundler resolves that package without it. The test beside this file checks
 * every shape against a real build, in that order.
 */
function browserBuild(specifier: string, resolved: string): string {
  if (!PACKAGE_ROOT.test(specifier)) return resolved;
  const root = packageRoot(specifier, resolved);
  if (!root || root.manifest.exports !== undefined) return resolved;
  const entry = root.manifest.module;
  if (typeof entry !== "string") return resolved;
  try {
    return Bun.resolveSync(entry.startsWith(".") ? entry : `./${entry}`, root.dir);
  } catch {
    // A field naming a file the package does not ship: `main` did resolve.
    return resolved;
  }
}

/** The directory and manifest of the package `specifier` names, found above the file it resolved to. */
function packageRoot(
  specifier: string,
  resolved: string,
): { dir: string; manifest: Record<string, unknown> } | null {
  let dir = dirname(resolved);
  // A build directory can carry a manifest of its own (`{"type":"module"}`);
  // only the one that names the package is the package's.
  for (let depth = 0; depth < 12; depth++) {
    try {
      const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as unknown;
      if (manifest && typeof manifest === "object" && "name" in manifest) {
        return manifest.name === specifier
          ? { dir, manifest: manifest as Record<string, unknown> }
          : null;
      }
    } catch {
      // No manifest at this level.
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

/**
 * Resolve an importPath to an absolute module path against the host app:
 * apply tsconfig aliases first, then Bun's normal resolution. Throws if unresolvable.
 */
export function resolveImport(
  importPath: string,
  hostRoot: string,
  aliases: { from: string; to: string }[],
): string {
  const aliased = applyAlias(importPath, aliases);
  return resolveModule(aliased ? join(hostRoot, aliased) : importPath, hostRoot);
}

/** Build plugin resolving `@/`-style aliases inside the component graph against the host root. */
export function aliasPlugin(hostRoot: string, aliases: { from: string; to: string }[]): BunPlugin {
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
          return { path: resolveModule(join(hostRoot, aliased), hostRoot) };
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
 * Bundle a set of components from a host app into one browser ESM module.
 * Resolves the host React + createRoot (a missing react-dom/client ⇒ the app is
 * pre-18 / RSC-only and can't client-mount). Per-entry resolution failures are
 * collected, not thrown; a build with zero resolvable entries returns the empty
 * fallback module.
 */
export async function bundleComponents(opts: {
  hostRoot: string;
  entries: BundleEntry[];
  aliases: { from: string; to: string }[];
  minify?: boolean;
  /** Cache key for the on-disk entry file (defaults to the host root). */
  cacheKey?: string;
}): Promise<BundleResult> {
  const { hostRoot, entries, aliases, minify = false } = opts;
  if (entries.length === 0) return { code: EMPTY_MODULE, errors: [] };

  let reactPath: string;
  let reactDomClientPath: string;
  try {
    reactPath = resolveModule("react", hostRoot);
    reactDomClientPath = resolveModule("react-dom/client", hostRoot);
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
  for (const { id, importPath } of entries) {
    try {
      resolved.push({ id, path: resolveImport(importPath, hostRoot, aliases) });
    } catch (err) {
      errors.push({
        importPath,
        message: `${id}: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }
  if (resolved.length === 0) return { code: EMPTY_MODULE, errors };

  const entrySource = buildEntrySource(reactPath, reactDomClientPath, resolved);
  const key = Bun.hash(opts.cacheKey ?? hostRoot).toString(16);
  const dir = join(tmpdir(), "velloo-live", key);
  await mkdir(dir, { recursive: true });
  const entryPath = join(dir, "entry.tsx");
  await writeFile(entryPath, entrySource, "utf8");

  let result: Awaited<ReturnType<typeof Bun.build>>;
  try {
    result = await buildHostSource({
      entrypoints: [entryPath],
      target: "browser",
      format: "esm",
      minify,
      sourcemap: "none",
      define: { "process.env.NODE_ENV": '"production"' },
      banner: PROCESS_SHIM,
      plugins: [aliasPlugin(hostRoot, aliases)],
    });
  } catch (err) {
    // Bun ≥1.2 throws an AggregateError instead of returning success: false —
    // map it into structured errors so the never-throws contract (and the
    // caller's SSR fallback) holds.
    for (const e of err instanceof AggregateError ? err.errors : [err]) {
      errors.push({ message: e instanceof Error ? e.message : String(e) });
    }
    return { code: EMPTY_MODULE, errors };
  }

  if (!result.success) {
    for (const log of result.logs)
      errors.push({ message: typeof log === "string" ? log : log.message });
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
 * Generate the bundle entrypoint: namespace-import each component (so a
 * named-by-id or default export both work), import the host React + createRoot,
 * and re-export a registry + a tiny ErrorBoundary the runtime wraps each mount in.
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
