import { readFile } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import type { Framework, ScannedRoute, ScanResult } from "./types.ts";
import { dirExists, walkFiles } from "./walk.ts";

const PAGE_EXTS = new Set([".tsx", ".ts", ".jsx", ".js"]);

function hasExt(file: string): boolean {
  const dot = file.lastIndexOf(".");
  if (dot === -1) return false;
  return PAGE_EXTS.has(file.slice(dot));
}

function stripExt(file: string): string {
  const dot = file.lastIndexOf(".");
  return dot === -1 ? file : file.slice(0, dot);
}

function titleCaseFromSegment(segment: string): string {
  if (segment === "") return "Index";
  if (segment === "index") return "Index";
  // Convert "user-settings" → "User settings", "_id" → "Id".
  const cleaned = segment.replace(/^[_[]+|[\]]+$/g, "").replace(/[-_]+/g, " ");
  if (!cleaned) return segment;
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/**
 * Produce a stable, slug-safe screen id from a route path. Examples:
 *   "/"                    → "index"
 *   "/dashboard"           → "dashboard"
 *   "/settings/account"    → "settings-account"
 *   "/blog/[slug]"         → "blog-slug"
 */
function idFromRoutePath(routePath: string): string {
  if (routePath === "/" || routePath === "") return "index";
  const out = routePath
    .replace(/^\//, "")
    .replace(/\//g, "-")
    .replace(/[[\]()]/g, "")
    .replace(/^_/, "")
    .replace(/[^a-zA-Z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  return out || "index";
}

function nameFromRoutePath(routePath: string): string {
  if (routePath === "/" || routePath === "") return "Home";
  const segments = routePath.replace(/^\//, "").split("/").map(titleCaseFromSegment);
  return segments.join(" / ");
}

/**
 * Walk Next.js's app router (`app/<route>/page.*`). Skips `route.*`
 * handlers, layouts, and not-found / error files — only `page.*` files
 * map to a renderable route.
 */
async function scanNextApp(appDir: string): Promise<ScannedRoute[]> {
  const out: ScannedRoute[] = [];
  for await (const file of walkFiles(appDir)) {
    const base = basename(file);
    const stem = stripExt(base);
    if (stem !== "page" || !hasExt(base)) continue;
    const rel = relative(appDir, dirname(file));
    // Convert "settings/(account)/profile" → "settings/profile" by
    // dropping Next's grouping parens. They don't change the URL.
    const routePath =
      `/${rel
        .split("/")
        .filter((s) => !s.startsWith("("))
        .join("/")}`.replace(/\/$/, "") || "/";
    const id = idFromRoutePath(routePath);
    out.push({
      id,
      name: nameFromRoutePath(routePath),
      routePath,
      sourceFile: file,
    });
  }
  return dedupe(out);
}

/**
 * Walk Next.js's pages router (`pages/<route>.*` or `pages/<route>/index.*`).
 * Skips `_app`, `_document`, `_error`, and API routes.
 */
async function scanNextPages(pagesDir: string): Promise<ScannedRoute[]> {
  const out: ScannedRoute[] = [];
  for await (const file of walkFiles(pagesDir)) {
    if (!hasExt(file)) continue;
    const base = basename(file);
    const stem = stripExt(base);
    if (stem.startsWith("_")) continue;
    const rel = relative(pagesDir, file);
    if (rel.startsWith("api/") || rel === "api") continue;
    const segments = rel.split("/");
    const last = stripExt(segments.pop() ?? "");
    const path = last === "index" ? segments : [...segments, last];
    const routePath = path.length === 0 ? "/" : `/${path.join("/")}`;
    out.push({
      id: idFromRoutePath(routePath),
      name: nameFromRoutePath(routePath),
      routePath,
      sourceFile: file,
    });
  }
  return dedupe(out);
}

/**
 * Generic fallback for Vite / React Router / Astro — walk
 * `src/pages/`, `src/routes/`, or `pages/` and treat each file as a
 * route. Astro and Vite-with-filesystem-router both follow this
 * convention closely enough to share one implementation.
 */
async function scanGenericPagesDir(dir: string): Promise<ScannedRoute[]> {
  const out: ScannedRoute[] = [];
  for await (const file of walkFiles(dir)) {
    if (!hasExt(file) && !file.endsWith(".astro")) continue;
    const base = basename(file);
    if (base.startsWith("_")) continue;
    const rel = relative(dir, file);
    const segments = rel.split("/");
    const last = stripExt(segments.pop() ?? "");
    const path = last === "index" ? segments : [...segments, last];
    const routePath = path.length === 0 ? "/" : `/${path.join("/")}`;
    out.push({
      id: idFromRoutePath(routePath),
      name: nameFromRoutePath(routePath),
      routePath,
      sourceFile: file,
    });
  }
  return dedupe(out);
}

/** Map one TanStack path segment: `$id` → `[id]`, splat `$` → `[splat]`. */
function tanstackSegment(seg: string): string {
  if (seg === "$") return "[splat]";
  if (seg.startsWith("$")) return `[${seg.slice(1)}]`;
  return seg;
}

/**
 * Walk a TanStack Router file-based routes dir (`src/routes`). Unlike the
 * generic walker, this understands the conventions so layouts and grouping
 * don't leak into the screen list:
 *   - `__root.*` and `route.*` (layout files) are not pages → skipped.
 *   - pathless layout segments (`_authenticated`) and route groups
 *     (`(auth)`) drop out of the URL.
 *   - `index` collapses to its parent path.
 *   - `$param` → `[param]` (and bare `$` splat → `[splat]`), reusing the
 *     same id/name logic as the bracketed Next.js dynamic segments.
 *   - both directory (`a/b.tsx`) and flat-dotted (`a.b.tsx`) nesting map to
 *     the same path; `.lazy` siblings and `routeTree.gen.*` are ignored.
 */
async function scanTanstackRouter(dir: string): Promise<ScannedRoute[]> {
  const out: ScannedRoute[] = [];
  for await (const file of walkFiles(dir)) {
    if (!hasExt(file)) continue;
    let stem = stripExt(relative(dir, file));
    if (stem.endsWith(".lazy")) stem = stem.slice(0, -".lazy".length);
    if (stem === "routeTree" || stem.endsWith(".gen")) continue;

    // TanStack treats both `/` and `.` as nesting separators.
    const raw = stem.split(/[/.]/).filter((s) => s.length > 0);
    const leaf = raw[raw.length - 1];
    if (!leaf) continue;
    // Layout / root files and `-`-prefixed (route-excluded) files aren't pages.
    if (leaf === "__root" || leaf === "route" || leaf.startsWith("_")) continue;
    if (raw.some((s) => s.startsWith("-"))) continue;

    const segments: string[] = [];
    for (const seg of raw) {
      if (seg === "index" || seg === "route") continue; // index collapses to parent
      if (seg.startsWith("_")) continue; // pathless layout
      if (/^\(.*\)$/.test(seg)) continue; // route group
      segments.push(tanstackSegment(seg));
    }
    const routePath = segments.length === 0 ? "/" : `/${segments.join("/")}`;
    out.push({
      id: idFromRoutePath(routePath),
      name: nameFromRoutePath(routePath),
      routePath,
      sourceFile: file,
    });
  }
  return dedupe(out);
}

/** Honor a `tsr.config.json` `routesDirectory` override, if present. */
async function tanstackRoutesDir(appRoot: string): Promise<string | null> {
  try {
    const cfg = JSON.parse(await readFile(join(appRoot, "tsr.config.json"), "utf8")) as {
      routesDirectory?: unknown;
    };
    if (typeof cfg.routesDirectory === "string") return join(appRoot, cfg.routesDirectory);
  } catch {
    // No config (or unreadable) — fall back to the conventional locations.
  }
  return null;
}

/**
 * Keep the first route per id — duplicates surface when both a
 * Next.js app dir and pages dir have the same route, or when a route
 * has both `.tsx` and `.ts` siblings (unusual but possible).
 */
function dedupe(routes: ScannedRoute[]): ScannedRoute[] {
  const seen = new Set<string>();
  const out: ScannedRoute[] = [];
  for (const r of routes) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }
  // Sort: index first, then alphabetical. Keeps the generated frames
  // in a predictable order on the board.
  out.sort((a, b) => {
    if (a.id === "index") return -1;
    if (b.id === "index") return 1;
    return a.id.localeCompare(b.id);
  });
  return out;
}

async function readPackageJson(appRoot: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await readFile(join(appRoot, "package.json"), "utf8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function detectFramework(appRoot: string): Promise<Framework> {
  const pkg = await readPackageJson(appRoot);
  const deps: Record<string, unknown> = {
    ...((pkg?.dependencies as Record<string, unknown>) ?? {}),
    ...((pkg?.devDependencies as Record<string, unknown>) ?? {}),
  };
  if ("next" in deps) {
    if (await dirExists(join(appRoot, "app"))) return "next-app";
    if (await dirExists(join(appRoot, "src", "app"))) return "next-app";
    if (await dirExists(join(appRoot, "pages"))) return "next-pages";
    if (await dirExists(join(appRoot, "src", "pages"))) return "next-pages";
    return "next-app";
  }
  if ("astro" in deps) return "astro";
  // TanStack Router rides on Vite, so check it first — its file conventions
  // (layouts, route groups, pathless segments) need dedicated parsing.
  if (
    "@tanstack/react-router" in deps ||
    "@tanstack/react-start" in deps ||
    "@tanstack/router-plugin" in deps
  ) {
    return "tanstack-router";
  }
  if ("vite" in deps) return "vite";
  return "unknown";
}

/**
 * Scan a host app for routes. Returns an empty `routes` array when no
 * framework/structure is detected — callers should treat that as "user
 * picked scan but there's nothing to find" rather than an error.
 */
export async function scanAppRoutes(appRoot: string): Promise<ScanResult> {
  const framework = await detectFramework(appRoot);

  if (framework === "next-app") {
    const candidates = [join(appRoot, "src", "app"), join(appRoot, "app")];
    for (const dir of candidates) {
      if (await dirExists(dir)) {
        return { framework, routes: await scanNextApp(dir), routesRoot: dir };
      }
    }
  }
  if (framework === "next-pages") {
    const candidates = [join(appRoot, "src", "pages"), join(appRoot, "pages")];
    for (const dir of candidates) {
      if (await dirExists(dir)) {
        return { framework, routes: await scanNextPages(dir), routesRoot: dir };
      }
    }
  }
  if (framework === "astro") {
    const candidates = [join(appRoot, "src", "pages"), join(appRoot, "pages")];
    for (const dir of candidates) {
      if (await dirExists(dir)) {
        return { framework, routes: await scanGenericPagesDir(dir), routesRoot: dir };
      }
    }
  }
  if (framework === "tanstack-router") {
    const candidates = [
      await tanstackRoutesDir(appRoot),
      join(appRoot, "src", "routes"),
      join(appRoot, "routes"),
    ];
    for (const dir of candidates) {
      if (dir && (await dirExists(dir))) {
        return { framework, routes: await scanTanstackRouter(dir), routesRoot: dir };
      }
    }
  }

  // Vite or unknown: try common patterns.
  for (const dir of [
    join(appRoot, "src", "routes"),
    join(appRoot, "src", "pages"),
    join(appRoot, "src", "views"),
    join(appRoot, "pages"),
  ]) {
    if (await dirExists(dir)) {
      return {
        framework: framework === "unknown" ? "unknown" : framework,
        routes: await scanGenericPagesDir(dir),
        routesRoot: dir,
      };
    }
  }

  return { framework, routes: [], routesRoot: appRoot };
}

/** True when the directory looks like a React app worth scanning. */
export async function looksLikeReactApp(appRoot: string): Promise<boolean> {
  const pkg = await readPackageJson(appRoot);
  if (!pkg) return false;
  const deps: Record<string, unknown> = {
    ...((pkg.dependencies as Record<string, unknown>) ?? {}),
    ...((pkg.devDependencies as Record<string, unknown>) ?? {}),
  };
  return "react" in deps || "next" in deps || "astro" in deps;
}
