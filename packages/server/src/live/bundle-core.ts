import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import type { HostApp } from "@velloo/schema";
import type { BunPlugin } from "bun";

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

/** Resolve the host app root: explicit config, else the design folder's parent. */
export function hostAppRootFrom(folderRoot: string, hostApp: HostApp | undefined): string {
  if (!hostApp?.root) return resolve(folderRoot, "..");
  return isAbsolute(hostApp.root) ? hostApp.root : resolve(folderRoot, hostApp.root);
}

/** Normalize a tsconfig-style alias map (`{ "@/*": "src/*" }`) to prefix pairs. */
export function aliasPairs(hostApp: HostApp | undefined): { from: string; to: string }[] {
  const raw = hostApp?.aliases ?? { "@/*": "*" };
  return Object.entries(raw).map(([pattern, target]) => ({
    from: pattern.replace(/\*$/, ""),
    to: target.replace(/\*$/, ""),
  }));
}

/** Rewrite an aliased specifier to a host-root-relative path, or null if no alias matches. */
export function applyAlias(spec: string, aliases: { from: string; to: string }[]): string | null {
  for (const { from, to } of aliases) {
    if (from && spec.startsWith(from)) return to + spec.slice(from.length);
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
  return Bun.resolveSync(aliased ? join(hostRoot, aliased) : importPath, hostRoot);
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

  const result = await Bun.build({
    entrypoints: [entryPath],
    target: "browser",
    format: "esm",
    minify,
    sourcemap: "none",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [aliasPlugin(hostRoot, aliases)],
  });

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
