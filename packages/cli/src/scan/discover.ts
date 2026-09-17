import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, dirname, join, relative, resolve, sep } from "node:path";
import { looksLikeUiApp } from "./routes.ts";

/**
 * Directory names that usually hold the UI in a polyglot repo (a Python/Go/Rust
 * backend with a JS frontend in a subfolder). Used only to break ties between
 * equally-shallow React apps — earlier in the list wins.
 */
const PREFERRED_DIRS = ["frontend", "web", "webapp", "client", "ui", "app", "www", "site"];

/** Build output / vendor dirs the manual walk skips (git already ignores these). */
const SKIP_DIRS = new Set(["node_modules", "dist", "build", ".next", ".turbo", "out"]);

/** Lower is better: shallowest path first, then a preferred UI dir name. */
function rank(rel: string): number {
  const segments = rel.split("/");
  const preferred = segments.reduce((best, seg) => {
    const i = PREFERRED_DIRS.indexOf(seg.toLowerCase());
    return i === -1 ? best : Math.min(best, i);
  }, PREFERRED_DIRS.length);
  return segments.length * 100 + preferred;
}

/**
 * Locate `package.json` directories via git, which respects `.gitignore` for
 * free (so build output and vendored deps never show up). Returns null when
 * `appRoot` isn't in a git work tree, or git lists nothing, so the caller can
 * fall back to a walk.
 *
 * Git never climbs into the home directory to find a repository: people keep
 * dotfiles in a repository there with `*` ignored, and a project that isn't a
 * repository of its own would otherwise list as empty — with no error — and
 * init would find no apps in it.
 */
async function gitPackageJsonDirs(appRoot: string): Promise<string[] | null> {
  try {
    const proc = Bun.spawn(
      [
        "git",
        "-C",
        appRoot,
        "ls-files",
        "--cached",
        "--others",
        "--exclude-standard",
        "-z",
        "--",
        "package.json",
        "*/package.json",
      ],
      { stdout: "pipe", stderr: "ignore", env: scanGitEnv() },
    );
    const out = await new Response(proc.stdout).text();
    if ((await proc.exited) !== 0) return null;
    const dirs = out
      .split("\0")
      .filter((p) => p.endsWith("package.json") && !p.includes("node_modules/"))
      .map((p) => resolve(appRoot, dirname(p)));
    return dirs.length > 0 ? dirs : null;
  } catch {
    return null;
  }
}

function scanGitEnv(): NodeJS.ProcessEnv {
  const inherited = process.env.GIT_CEILING_DIRECTORIES;
  const ceilings = inherited ? [homedir(), inherited] : [homedir()];
  return { ...process.env, GIT_CEILING_DIRECTORIES: ceilings.join(delimiter) };
}

/** Fallback for non-git trees: a bounded walk for `package.json` directories. */
async function walkPackageJsonDirs(root: string, maxDepth: number): Promise<string[]> {
  const out: string[] = [];
  async function recurse(dir: string, depth: number): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => null);
    if (!entries) return;
    if (entries.some((e) => e.isFile() && e.name === "package.json")) out.push(dir);
    if (depth >= maxDepth) return;
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
      await recurse(join(dir, entry.name), depth + 1);
    }
  }
  await recurse(root, 0);
  return out;
}

/** A UI-app directory discovered under the app root. */
export interface DiscoveredApp {
  /** Absolute directory. */
  dir: string;
  /** `dir` relative to the app root ("" when it's the root itself). */
  rel: string;
}

/**
 * Find every directory that holds a UI app under `appRoot`, best-ranked
 * first (the root itself, then shallowest / conventional UI dir names). A
 * plain app returns one entry; a monorepo returns one per workspace app.
 * Empty when nothing UI-shaped is found.
 */
export async function discoverScanRoots(appRoot: string): Promise<DiscoveredApp[]> {
  const out: DiscoveredApp[] = [];
  if (await looksLikeUiApp(appRoot)) out.push({ dir: appRoot, rel: "" });

  const dirs = (await gitPackageJsonDirs(appRoot)) ?? (await walkPackageJsonDirs(appRoot, 5));
  const nested: DiscoveredApp[] = [];
  for (const dir of new Set(dirs)) {
    if (dir === appRoot) continue;
    if (await looksLikeUiApp(dir))
      nested.push({ dir, rel: relative(appRoot, dir).split(sep).join("/") });
  }
  nested.sort((a, b) => rank(a.rel) - rank(b.rel) || a.rel.localeCompare(b.rel));
  return [...out, ...nested];
}

/**
 * Find the directory that holds the host's UI app. Fast-paths `appRoot`
 * itself (the common case); otherwise — e.g. a Python repo whose UI lives in
 * `web/frontend/` and whose root has no `package.json` — searches for a nested
 * UI app, preferring the shallowest and a conventional UI dir name. Returns
 * null when nothing UI-shaped is found.
 */
export async function findScanRoot(appRoot: string): Promise<string | null> {
  return (await discoverScanRoots(appRoot))[0]?.dir ?? null;
}
