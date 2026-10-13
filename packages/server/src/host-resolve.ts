import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, sep } from "node:path";

/**
 * Module resolution that answers only for what the host app has.
 *
 * Bun's resolver does not stop at "not installed". From a directory with no
 * `node_modules` at or above it — a static site, a Flask app, a clone nobody
 * has installed yet — it switches to auto-install: a bare specifier resolves
 * out of Bun's global install cache, and one the cache lacks is downloaded from
 * npm first. Velloo asks the resolver whether an app has a package, so every
 * app with no dependencies at all "had" Mantine, got its stylesheet in every
 * render, and paid for the answer with a download.
 *
 * The CLI starts Bun with auto-install off (`BUN_RUNTIME_FLAGS`). These hold
 * for a process started some other way.
 */

/** Whether Node-style resolution from `dir` has a `node_modules` to look in. */
function reachesNodeModules(dir: string): boolean {
  for (let at = dir; ; ) {
    if (existsSync(join(at, "node_modules"))) return true;
    const parent = dirname(at);
    if (parent === at) return false;
    at = parent;
  }
}

/** A package directory of Bun's install cache: `<name>@<version>@@@<n>`. */
const INSTALL_CACHE_ENTRY = /@@@\d+(?:[\\/]|$)/;

/**
 * `Bun.resolveSync`, refusing an answer that came out of Bun's install cache
 * instead of the app. Throws as `Bun.resolveSync` does.
 *
 * For a specifier of any kind — a tsconfig alias resolves with no
 * `node_modules` anywhere, so the resolver still has to be asked.
 *
 * A workspace root answers for its members: see {@link resolveInWorkspace}.
 */
export function resolveInHost(specifier: string, from: string): string {
  const bare = !specifier.startsWith(".") && !isAbsolute(specifier);
  try {
    const resolved = Bun.resolveSync(specifier, from);
    if (
      bare &&
      INSTALL_CACHE_ENTRY.test(resolved) &&
      // A symlinking install links `node_modules/<pkg>` into the cache, and that
      // is the app's own copy. Auto-install only answers when there is none.
      !reachesNodeModules(from)
    ) {
      throw new Error(`Cannot find module '${specifier}' from '${from}'`);
    }
    return resolved;
  } catch (error) {
    const found = bare ? resolveInWorkspace(specifier, from) : null;
    if (found === null) throw error;
    if (found.path !== undefined) return found.path;
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}. Its workspaces ${found.members.join(", ")} each have their own copy.`,
    );
  }
}

/**
 * Where a package the host app has installed resolves, or null when it has no
 * such package. For a specifier known to name a package: with no
 * `node_modules` to find it in there is nothing to ask, and asking is what
 * makes Bun download it.
 */
export function resolveHostPackage(specifier: string, hostRoot: string): string | null {
  if (reachesNodeModules(hostRoot)) {
    try {
      return Bun.resolveSync(specifier, hostRoot);
    } catch {
      // Not at the root; a workspace below it may still have it.
    }
  }
  return resolveInWorkspace(specifier, hostRoot)?.path ?? null;
}

/**
 * What a workspace root's members have that the root does not.
 *
 * A design can point at a monorepo's root — `init` records the directory it
 * was run in — while the app is a workspace below it. Unless the install
 * hoists, the root's `node_modules` then holds none of the app's dependencies:
 * React "was not installed", so no screen mounted and every component on it
 * fell back to Velloo's bundled copy, while the app's own files went on
 * importing the React that sits beside them.
 *
 * So from a directory that declares workspaces, a package the directory cannot
 * resolve is the one its members resolve — when they agree on it. Two members
 * with a copy each is a different question (which app is this design for?),
 * and that one has no answer here: the members are named instead.
 *
 * Null when `from` declares no workspaces or none of them has the package.
 */
function resolveInWorkspace(
  specifier: string,
  from: string,
): { path: string; members?: undefined } | { path?: undefined; members: string[] } | null {
  const answers = new Map<string, { path: string; members: string[] }>();
  for (const member of workspaceMembers(from)) {
    // The same guard as above: with nothing installed, asking downloads it.
    if (!reachesNodeModules(member)) continue;
    let path: string;
    try {
      path = Bun.resolveSync(specifier, member);
    } catch {
      continue;
    }
    const real = realOr(path);
    const answer = answers.get(real) ?? { path, members: [] };
    answer.members.push(relative(from, member).split(sep).join("/"));
    answers.set(real, answer);
  }
  const [first, ...rest] = [...answers.values()];
  if (!first) return null;
  if (rest.length === 0) return { path: first.path };
  return { members: [first, ...rest].flatMap((answer) => answer.members) };
}

function realOr(path: string): string {
  try {
    return realpathSync.native(path);
  } catch {
    return path;
  }
}

/** Keyed by the declaring files' text, so an edited workspace list is read again. */
const membersByDeclaration = new Map<string, string[]>();

/**
 * The workspace directories `root` declares — `workspaces` in its
 * `package.json` (npm, Yarn, Bun) or `packages` in `pnpm-workspace.yaml` —
 * that exist and hold a `package.json`. Empty for a directory that declares
 * none, which is every directory but a monorepo's root.
 */
function workspaceMembers(root: string): string[] {
  const manifest = readOr(join(root, "package.json"));
  const pnpm = readOr(join(root, "pnpm-workspace.yaml"));
  if (manifest === null && pnpm === null) return [];
  const key = `${root}\0${manifest}\0${pnpm}`;
  const cached = membersByDeclaration.get(key);
  if (cached) return cached;

  const patterns = [...manifestWorkspaces(manifest), ...pnpmWorkspaces(pnpm)];
  const excluded = patterns.filter((p) => p.startsWith("!")).map((p) => new Bun.Glob(p.slice(1)));
  const members = new Set<string>();
  for (const pattern of patterns) {
    if (pattern.startsWith("!")) continue;
    const segments = pattern.replace(/^\.\//, "").split("/").filter(Boolean);
    for (const dir of expand(root, segments, 0)) {
      const rel = relative(root, dir).split(sep).join("/");
      if (rel === "" || excluded.some((glob) => glob.match(rel))) continue;
      if (existsSync(join(dir, "package.json"))) members.add(dir);
    }
  }
  const out = [...members].sort();
  membersByDeclaration.set(key, out);
  return out;
}

function readOr(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function manifestWorkspaces(manifest: string | null): string[] {
  if (manifest === null) return [];
  try {
    const { workspaces } = JSON.parse(manifest) as { workspaces?: unknown };
    const list = Array.isArray(workspaces)
      ? workspaces
      : (workspaces as { packages?: unknown } | undefined)?.packages;
    return Array.isArray(list) ? list.filter((p): p is string => typeof p === "string") : [];
  } catch {
    return [];
  }
}

/** The `packages:` list of a `pnpm-workspace.yaml` — a flat list of strings, read as one. */
function pnpmWorkspaces(yaml: string | null): string[] {
  if (yaml === null) return [];
  const out: string[] = [];
  let inPackages = false;
  for (const line of yaml.split(/\r?\n/)) {
    if (/^\S/.test(line)) inPackages = /^packages\s*:/.test(line);
    const item = inPackages ? /^\s*-\s*(?:"([^"]+)"|'([^']+)'|([^#\s]+))/.exec(line) : null;
    const pattern = item?.[1] ?? item?.[2] ?? item?.[3];
    if (pattern) out.push(pattern);
  }
  return out;
}

/** How far `**` looks. A workspace pattern that nests deeper than this is not one people write. */
const MAX_GLOBSTAR_DEPTH = 4;

/** The directories a workspace pattern names, never looking inside `node_modules`. */
function expand(dir: string, segments: string[], depth: number): string[] {
  const [segment, ...rest] = segments;
  if (segment === undefined) return [dir];
  if (!/[*?[{]/.test(segment)) {
    const next = join(dir, segment);
    return existsSync(next) ? expand(next, rest, depth) : [];
  }
  const children = subdirectories(dir);
  if (segment === "**") {
    const here = expand(dir, rest, depth);
    if (depth >= MAX_GLOBSTAR_DEPTH) return here;
    return [...here, ...children.flatMap((child) => expand(join(dir, child), segments, depth + 1))];
  }
  const glob = new Bun.Glob(segment);
  return children
    .filter((child) => glob.match(child))
    .flatMap((child) => expand(join(dir, child), rest, depth));
}

function subdirectories(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name !== "node_modules" && !e.name.startsWith("."))
      .map((e) => e.name);
  } catch {
    return [];
  }
}
