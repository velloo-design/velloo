import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isBuiltin } from "node:module";
import { dirname, extname, join, relative, sep } from "node:path";
import type { RepoComponentRef } from "@velloo/schema";
import { type JsxElement, type ModuleScan, scanModule } from "./source-scan.ts";
import { findFiles } from "./walk.ts";

/**
 * Bounded repository-component discovery: start from the app's entries and
 * routes, follow its local imports, and record every JSX element whose binding
 * comes from a direct dependency or from the app's own source. Only what the
 * app actually renders is found — an unused package export never appears, and
 * nothing under `node_modules` is walked. No application code runs.
 */

export interface DiscoverOptions {
  hostRoot: string;
  aliases: { from: string; to: string }[];
  /** `config.hostApps` key; absent ⇒ the default app. */
  app?: string | undefined;
  /** Extra component roots (files or directories, host-root relative). */
  include?: string[] | undefined;
  /** Specifier prefixes or host-relative path prefixes to leave out. */
  exclude?: string[] | undefined;
  /**
   * Modules a framework adapter already owns (the shadcn `ui/` dir,
   * `@mui/material`): they are the provider's catalog, not the repository's.
   */
  owned?: ((specifier: string, resolved: string | null) => boolean) | undefined;
  maxFiles?: number | undefined;
}

interface DiscoveredUsage {
  /** Host-relative file and 1-based line. */
  at: string;
  /** Literal attribute values. */
  props: Record<string, unknown>;
  /** Attributes whose value is code (handlers, variables, JSX) — never evaluated. */
  expressions: string[];
  text?: string;
  /** Written with children (`<X>…</X>`), not self-closing. */
  hasChildren: boolean;
}

export interface DiscoveredComponent {
  /** The JSX name the app uses: `Tabs`, `Tabs.List`, `StatCard`. */
  name: string;
  identity: RepoComponentRef;
  source: "package" | "local";
  /** npm package name for a package component. */
  packageName?: string;
  /** Resolved module file — runtime data for extraction, never persisted. */
  file?: string;
  usages: DiscoveredUsage[];
}

/** A `*Provider` element an entry wraps the app in — a preview-entry hint. */
interface DiscoveredWrapper {
  name: string;
  identity: RepoComponentRef;
  at: string;
  props: Record<string, unknown>;
  expressions: string[];
}

export interface DiscoveryResult {
  components: DiscoveredComponent[];
  wrappers: DiscoveredWrapper[];
  /** Side-effect stylesheet imports (`import "@mantine/core/styles.css"`), host-relative `at`. */
  globalStyles: { specifier: string; at: string }[];
  entries: string[];
  /** Every file read — a change to any of them invalidates the result. */
  files: string[];
  skipped: { file: string; reason: "server-only" }[];
}

const SCRIPT_EXTS = new Set([".tsx", ".jsx", ".ts", ".js", ".mts", ".mjs"]);
const STYLE_EXTS = /\.(css|scss|sass|less)$/;
const IGNORED_DIRS =
  /(^|[\\/])(node_modules|dist|build|out|coverage|\.next|\.turbo|\.git|velloo)([\\/]|$)/;
const ALWAYS_EXCLUDED_PACKAGES = new Set(["react", "react-dom"]);
const MAX_USAGES = 6;

const ENTRY_PATTERNS = [
  "src/{main,index,App,app}.{tsx,jsx,ts,js}",
  "{main,index,App}.{tsx,jsx}",
  "app/**/{page,layout,root}.{tsx,jsx,ts,js}",
  "src/app/**/{page,layout}.{tsx,jsx,ts,js}",
  "app/root.{tsx,jsx}",
  "app/routes/**/*.{tsx,jsx}",
  "pages/**/*.{tsx,jsx}",
  "src/pages/**/*.{tsx,jsx}",
  "src/routes/**/*.{tsx,jsx}",
];

export async function discoverRepoComponents(opts: DiscoverOptions): Promise<DiscoveryResult> {
  // Module resolution answers with real paths; compare against the same form,
  // or a symlinked root (macOS's /var → /private/var) disowns every file.
  const hostRoot = realRoot(opts.hostRoot);
  const maxFiles = opts.maxFiles ?? 3000;
  const deps = directDependencies(hostRoot);
  const rel = (file: string) => relative(hostRoot, file).split(sep).join("/");
  const walkable = (file: string | null): file is string =>
    file !== null &&
    SCRIPT_EXTS.has(extname(file)) &&
    !rel(file).startsWith("..") &&
    !IGNORED_DIRS.test(rel(file));
  const excluded = (specifier: string, file: string | null): boolean =>
    (opts.exclude ?? []).some(
      (prefix) => specifier.startsWith(prefix) || (file !== null && rel(file).startsWith(prefix)),
    );

  const entries = await findEntries(hostRoot);
  const includeFiles = await filesUnder(hostRoot, opts.include ?? []);
  const queue = [...entries, ...includeFiles];
  const seen = new Set<string>();
  const skipped: DiscoveryResult["skipped"] = [];
  const components = new Map<string, DiscoveredComponent>();
  const wrappers = new Map<string, DiscoveredWrapper>();
  const globalStyles: DiscoveryResult["globalStyles"] = [];
  const includeSet = new Set(includeFiles);

  while (queue.length > 0 && seen.size < maxFiles) {
    const file = queue.shift() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    let scan: ModuleScan;
    try {
      if (statSync(file).size > 1_000_000) continue;
      scan = scanModule(readFileSync(file, "utf8"));
    } catch {
      continue;
    }
    if (scan.serverOnly || /\.server\.[jt]sx?$/.test(file)) {
      skipped.push({ file: rel(file), reason: "server-only" });
      continue;
    }

    const bindings = new Map<
      string,
      { specifier: string; imported: string; local: boolean; resolved: string | null }
    >();
    for (const decl of scan.imports) {
      const local = isLocalSpecifier(decl.specifier, opts.aliases);
      const resolved = local ? resolveLocal(decl.specifier, file, hostRoot, opts.aliases) : null;
      if (decl.sideEffect) {
        if (STYLE_EXTS.test(decl.specifier)) {
          globalStyles.push({ specifier: decl.specifier, at: `${rel(file)}:${decl.line}` });
        } else if (walkable(resolved)) queue.push(resolved);
        continue;
      }
      if (decl.typeOnly) continue;
      if (walkable(resolved)) queue.push(resolved);
      for (const binding of decl.bindings) {
        bindings.set(binding.local, {
          specifier: decl.specifier,
          imported: binding.imported,
          local,
          resolved,
        });
      }
    }
    for (const re of scan.reExports) {
      if (!isLocalSpecifier(re.specifier, opts.aliases)) continue;
      const resolved = resolveLocal(re.specifier, file, hostRoot, opts.aliases);
      if (walkable(resolved)) queue.push(resolved);
    }

    // A configured component root declares its exports even before a route renders them.
    if (includeSet.has(file)) {
      for (const exported of scan.componentExports) {
        const name = exported === "default" ? scan.defaultExportName : exported;
        if (!name) continue;
        const identity: RepoComponentRef = {
          importPath: rootRelativeSpecifier(file, hostRoot),
          exportName: exported,
          ...(opts.app ? { app: opts.app } : {}),
        };
        record(components, { name, identity, source: "local", file }, null);
      }
    }

    // `component={ScrollArea}` renders an import without a JSX tag of its own.
    const references = scan.elements.flatMap((element) =>
      element.attributes
        .filter(
          (attr) => attr.expression && /^[A-Z][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(attr.expression),
        )
        .map((attr) => ({ tag: attr.expression as string, element: null })),
    );
    for (const { tag, element } of [
      ...scan.elements.map((element) => ({ tag: element.tag, element })),
      ...references,
    ]) {
      const [root, ...members] = tag.split(".");
      const binding = root ? bindings.get(root) : undefined;
      if (!binding) continue;
      const packageName = binding.local ? undefined : packageOf(binding.specifier);
      if (packageName !== undefined) {
        if (!deps.has(packageName) || ALWAYS_EXCLUDED_PACKAGES.has(packageName)) continue;
        if (isBuiltin(packageName)) continue;
      } else if (!walkable(binding.resolved)) continue;
      if (excluded(binding.specifier, binding.resolved)) continue;
      if (opts.owned?.(binding.specifier, binding.resolved)) continue;

      let exportName = binding.imported;
      let memberPath = members;
      if (exportName === "*") {
        const [first, ...rest] = members;
        if (!first) continue;
        exportName = first;
        memberPath = rest;
      }
      const identity: RepoComponentRef = {
        importPath:
          binding.local && binding.specifier.startsWith(".") && binding.resolved
            ? rootRelativeSpecifier(binding.resolved, hostRoot)
            : binding.specifier,
        exportName,
        ...(memberPath.length > 0 ? { member: memberPath.join(".") } : {}),
        ...(opts.app ? { app: opts.app } : {}),
      };
      const displayRoot = exportName === "default" ? root : exportName;
      const name = [displayRoot, ...memberPath].join(".");
      const usage = element ? usageOf(element, `${rel(file)}:${element.line}`) : null;
      if (usage && memberPath.length === 0 && /Provider$/.test(name)) {
        const key = `${identity.importPath}#${exportName}`;
        if (!wrappers.has(key)) {
          wrappers.set(key, {
            name,
            identity,
            at: usage.at,
            props: usage.props,
            expressions: usage.expressions,
          });
        }
        continue;
      }
      record(
        components,
        {
          name,
          identity,
          source: packageName !== undefined ? "package" : "local",
          ...(packageName !== undefined ? { packageName } : {}),
          ...(binding.resolved ? { file: binding.resolved } : {}),
        },
        usage,
      );
    }
  }

  return {
    components: [...components.values()],
    wrappers: [...wrappers.values()],
    globalStyles,
    entries: entries.map(rel),
    files: [...seen],
    skipped,
  };
}

function record(
  into: Map<string, DiscoveredComponent>,
  component: Omit<DiscoveredComponent, "usages">,
  usage: DiscoveredUsage | null,
): void {
  const { identity } = component;
  const key = `${identity.app ?? ""}:${identity.importPath}#${identity.exportName}.${identity.member ?? ""}`;
  let entry = into.get(key);
  if (!entry) {
    entry = { ...component, usages: [] };
    into.set(key, entry);
  }
  if (usage && entry.usages.length < MAX_USAGES) entry.usages.push(usage);
}

function usageOf(element: JsxElement, at: string): DiscoveredUsage {
  const props: Record<string, unknown> = {};
  const expressions: string[] = [];
  for (const attr of element.attributes) {
    if (attr.expression !== undefined) expressions.push(attr.name);
    else props[attr.name] = attr.value;
  }
  return {
    at,
    props,
    expressions,
    hasChildren: !element.selfClosing,
    ...(element.text ? { text: element.text } : {}),
  };
}

/** Package name of a bare specifier: `@scope/pkg/sub` → `@scope/pkg`. */
export function packageOf(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? specifier);
}

function isLocalSpecifier(specifier: string, aliases: { from: string; to: string }[]): boolean {
  if (specifier.startsWith(".") || specifier.startsWith("/")) return true;
  return aliases.some(({ from }) => from !== "" && specifier.startsWith(from));
}

function resolveLocal(
  specifier: string,
  fromFile: string,
  hostRoot: string,
  aliases: { from: string; to: string }[],
): string | null {
  try {
    if (specifier.startsWith(".")) return Bun.resolveSync(specifier, dirname(fromFile));
    for (const { from, to } of aliases) {
      if (from && specifier.startsWith(from)) {
        return Bun.resolveSync(join(hostRoot, to + specifier.slice(from.length)), hostRoot);
      }
    }
  } catch {
    // An unresolvable local import is the app's own problem; nothing to follow.
  }
  return null;
}

/** `./src/components/stat-card` — relative to the host root, extension and `/index` dropped. */
function rootRelativeSpecifier(file: string, hostRoot: string): string {
  const path = relative(hostRoot, file)
    .split(sep)
    .join("/")
    .replace(/\.(tsx|jsx|ts|js|mts|mjs)$/, "")
    .replace(/\/index$/, "");
  return `./${path}`;
}

function directDependencies(hostRoot: string): Set<string> {
  const out = new Set<string>();
  const pkgPath = join(hostRoot, "package.json");
  if (!existsSync(pkgPath)) return out;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as Record<string, unknown>;
    for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
      const deps = pkg[field];
      if (deps && typeof deps === "object") for (const name of Object.keys(deps)) out.add(name);
    }
  } catch {
    // A malformed package.json yields no package components, not a crash.
  }
  return out;
}

async function findEntries(hostRoot: string): Promise<string[]> {
  const found = new Set<string>();
  const html = join(hostRoot, "index.html");
  if (existsSync(html)) {
    const source = readFileSync(html, "utf8");
    for (const match of source.matchAll(
      /<script\b[^>]*type=["']module["'][^>]*src=["']([^"']+)["']/g,
    )) {
      const file = join(hostRoot, (match[1] ?? "").replace(/^\//, ""));
      if (existsSync(file)) found.add(file);
    }
  }
  for (const pattern of ENTRY_PATTERNS) {
    for await (const match of new Bun.Glob(pattern).scan({ cwd: hostRoot, onlyFiles: true })) {
      if (IGNORED_DIRS.test(match)) continue;
      found.add(join(hostRoot, match));
    }
  }
  return [...found].sort();
}

async function filesUnder(hostRoot: string, roots: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const root of roots) {
    const abs = join(hostRoot, root);
    if (!existsSync(abs)) continue;
    if (statSync(abs).isFile()) {
      out.push(abs);
      continue;
    }
    out.push(
      ...(await findFiles(
        abs,
        (name) => /\.[jt]sx$/.test(name) && !/\.(test|spec|stories)\./.test(name),
      )),
    );
  }
  return out.sort();
}

function realRoot(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}
