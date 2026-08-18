import { readdir } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { looksLikeReactApp } from "./routes.ts";

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
 * `appRoot` isn't in a git work tree, so the caller can fall back to a walk.
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
      { stdout: "pipe", stderr: "ignore" },
    );
    const out = await new Response(proc.stdout).text();
    if ((await proc.exited) !== 0) return null;
    return out
      .split("\0")
      .filter((p) => p.endsWith("package.json") && !p.includes("node_modules/"))
      .map((p) => resolve(appRoot, dirname(p)));
  } catch {
    return null;
  }
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

/**
 * Find the directory that holds the host's React app. Fast-paths `appRoot`
 * itself (the common case); otherwise — e.g. a Python repo whose UI lives in
 * `web/frontend/` and whose root has no `package.json` — searches for a nested
 * React app, preferring the shallowest and a conventional UI dir name. Returns
 * null when nothing React-shaped is found.
 */
export async function findScanRoot(appRoot: string): Promise<string | null> {
  if (await looksLikeReactApp(appRoot)) return appRoot;

  const dirs = (await gitPackageJsonDirs(appRoot)) ?? (await walkPackageJsonDirs(appRoot, 5));
  const candidates: { dir: string; rel: string }[] = [];
  for (const dir of new Set(dirs)) {
    if (dir === appRoot) continue;
    if (await looksLikeReactApp(dir)) candidates.push({ dir, rel: relative(appRoot, dir) });
  }
  candidates.sort((a, b) => rank(a.rel) - rank(b.rel) || a.rel.localeCompare(b.rel));
  return candidates[0]?.dir ?? null;
}

export interface ResolvedScanRoot {
  /** Absolute directory `detectHost` / `scanAppRoutes` should run against. */
  scanRoot: string;
  /** `scanRoot` relative to the app root ("" when they're the same). */
  relToApp: string;
  /** True when discovery picked a subfolder the user didn't name explicitly. */
  autoDiscovered: boolean;
}

/**
 * Decide where to scan: an explicit `--scan-dir` wins; otherwise auto-discover
 * a nested React app; otherwise fall back to `appRoot`. The design folder still
 * installs at `appRoot` — only the scan source + theme import shift.
 */
export async function resolveScanRoot(
  appRoot: string,
  scanDir?: string,
): Promise<ResolvedScanRoot> {
  if (scanDir?.trim()) {
    const scanRoot = resolve(appRoot, scanDir.trim());
    return { scanRoot, relToApp: relative(appRoot, scanRoot), autoDiscovered: false };
  }
  const found = await findScanRoot(appRoot);
  if (found && found !== appRoot) {
    return { scanRoot: found, relToApp: relative(appRoot, found), autoDiscovered: true };
  }
  return { scanRoot: appRoot, relToApp: "", autoDiscovered: false };
}
