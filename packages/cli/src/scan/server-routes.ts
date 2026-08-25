import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { idFromRoutePath, nameFromRoutePath } from "./route-names.ts";
import type { ScannedRoute, ScanResult } from "./types.ts";

/**
 * Best-effort route extraction for server-rendered apps (Django / Flask /
 * FastAPI / Rails / Laravel). Velloo's scan only needs the route *shape* to
 * scaffold placeholder screens — the design is rebuilt from velloo's own
 * components, so the host language never matters. Everything here is
 * regex-based and deliberately forgiving: a route we can't parse is dropped,
 * never a crash.
 */

/** Dirs a Python/Ruby/PHP walk should never descend into. */
const SKIP_DIRS = new Set([
  "node_modules",
  "venv",
  "env",
  "__pycache__",
  "migrations",
  "site-packages",
  "vendor",
  "storage",
  "tmp",
  "log",
]);

/** Bounded recursive file collection — server repos can be huge. */
async function collectFiles(
  root: string,
  match: (name: string) => boolean,
  maxDepth = 5,
  maxFiles = 500,
): Promise<string[]> {
  const out: string[] = [];
  async function recurse(dir: string, depth: number): Promise<void> {
    if (out.length >= maxFiles) return;
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => null);
    if (!entries) return;
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (out.length >= maxFiles) return;
      if (entry.name.startsWith(".")) continue;
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || depth >= maxDepth) continue;
        await recurse(join(dir, entry.name), depth + 1);
      } else if (entry.isFile() && match(entry.name)) {
        out.push(join(dir, entry.name));
      }
    }
  }
  await recurse(root, 0);
  return out;
}

/** `<int:pk>` / `<pk>` (Django, Flask) and `{id}` / `{id?}` (FastAPI, Laravel) → `[pk]`. */
function normalizeParams(path: string): string {
  return path.replace(/<(?:\w+:)?(\w+)>/g, "[$1]").replace(/\{(\w+)\??\}/g, "[$1]");
}

/** Leading slash, no trailing slash (except the root itself). */
function normalizePath(raw: string): string {
  const withSlash = raw.startsWith("/") ? raw : `/${raw}`;
  const trimmed = withSlash.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

/** Routes under these top segments are infrastructure, not designable pages. */
function isPageRoute(routePath: string): boolean {
  const first = routePath.split("/").filter(Boolean)[0] ?? "";
  return first !== "api" && first !== "admin" && first !== "static" && first !== "media";
}

function toRoute(routePath: string, sourceFile: string): ScannedRoute {
  return {
    id: idFromRoutePath(routePath),
    name: nameFromRoutePath(routePath),
    routePath,
    sourceFile,
  };
}

/** Same policy as the JS scanners: first id wins, index first then alpha. */
function dedupeAndSort(routes: ScannedRoute[]): ScannedRoute[] {
  const seen = new Set<string>();
  const out: ScannedRoute[] = [];
  for (const r of routes) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }
  out.sort((a, b) => {
    if (a.id === "index") return -1;
    if (b.id === "index") return 1;
    return a.id.localeCompare(b.id);
  });
  return out;
}

/**
 * Django: parse `path("...")` / `re_path(r"^...$")` entries out of every
 * `urls.py`. `include(...)` mounts are skipped — the included app's own
 * `urls.py` is scanned directly instead, prefixed with its package dir name
 * (the conventional mount point), so `blog/urls.py` yields `/blog/...`.
 */
async function scanDjango(appRoot: string): Promise<ScannedRoute[]> {
  const files = await collectFiles(appRoot, (n) => n === "urls.py");
  const routes: ScannedRoute[] = [];
  for (const file of files) {
    const content = await readFile(file, "utf8").catch(() => null);
    if (!content) continue;
    // The project package (holds settings.py) is the root urlconf — no
    // prefix. App packages mount under their package name by convention.
    const pkgDir = dirname(file);
    const isRootConf = existsSync(join(pkgDir, "settings.py")) || pkgDir === appRoot;
    const prefix = isRootConf ? "" : `/${basename(pkgDir)}`;

    const entry = /\b(?:path|re_path|url)\(\s*r?["']([^"']*)["']/g;
    for (const m of content.matchAll(entry)) {
      const rest = content.slice(m.index, content.indexOf("\n", m.index));
      if (rest.includes("include(") || rest.includes("admin.site.urls")) continue;
      let raw = m[1] ?? "";
      raw = raw.replace(/^\^/, "").replace(/\$$/, "");
      raw = raw.replace(/\(\?P<(\w+)>[^)]*\)/g, "[$1]");
      raw = normalizeParams(raw);
      if (/[\\^$+*?()|]/.test(raw)) continue; // regex we can't flatten
      const routePath = normalizePath(`${prefix}/${raw}`.replace(/\/+/g, "/"));
      if (!isPageRoute(routePath)) continue;
      routes.push(toRoute(routePath, file));
    }
  }
  return dedupeAndSort(routes);
}

/**
 * Flask + FastAPI: GET decorators (`@app.route(...)`, `@bp.get(...)`,
 * `@router.get(...)`) across the repo's Python files. A `.route` with a
 * `methods=` list that excludes GET is skipped when the list fits on the
 * decorator line.
 */
async function scanPythonDecorators(appRoot: string): Promise<ScannedRoute[]> {
  const files = await collectFiles(appRoot, (n) => n.endsWith(".py"));
  const routes: ScannedRoute[] = [];
  for (const file of files) {
    const content = await readFile(file, "utf8").catch(() => null);
    if (!content) continue;
    const entry = /@\w+\.(route|get)\(\s*["']([^"']+)["']([^)\n]*)/g;
    for (const m of content.matchAll(entry)) {
      const [, kind, raw, rest] = m;
      if (kind === "route" && rest && /methods\s*=/.test(rest) && !/GET/.test(rest)) continue;
      const routePath = normalizePath(normalizeParams(raw ?? ""));
      if (!isPageRoute(routePath)) continue;
      routes.push(toRoute(routePath, file));
    }
  }
  return dedupeAndSort(routes);
}

/**
 * Rails: line-based parse of `config/routes.rb` — `root`, `get "..."`, and
 * `resources`/`resource` (index + show). `namespace`/`scope` nesting is not
 * prefix-tracked (best-effort).
 */
async function scanRails(routesRb: string): Promise<ScannedRoute[]> {
  const content = await readFile(routesRb, "utf8").catch(() => null);
  if (!content) return [];
  const routes: ScannedRoute[] = [];
  for (const line of content.split("\n")) {
    if (/^\s*root\b/.test(line)) {
      routes.push(toRoute("/", routesRb));
      continue;
    }
    const get = line.match(/^\s*get\s+["']([^"']+)["']/);
    if (get?.[1]) {
      const routePath = normalizePath(get[1].replace(/:(\w+)/g, "[$1]").replace(/\*\w+/g, ""));
      if (isPageRoute(routePath)) routes.push(toRoute(routePath, routesRb));
      continue;
    }
    const res = line.match(/^\s*(resources|resource)\s+:(\w+)/);
    if (res?.[2]) {
      const base = normalizePath(res[2]);
      if (!isPageRoute(base)) continue;
      routes.push(toRoute(base, routesRb));
      if (res[1] === "resources") routes.push(toRoute(`${base}/[id]`, routesRb));
    }
  }
  return dedupeAndSort(routes);
}

/** Laravel: `Route::get(...)` / `Route::view(...)` in `routes/web.php`. */
async function scanLaravel(webPhp: string): Promise<ScannedRoute[]> {
  const content = await readFile(webPhp, "utf8").catch(() => null);
  if (!content) return [];
  const routes: ScannedRoute[] = [];
  const entry = /Route::(?:get|view)\(\s*["']([^"']+)["']/g;
  for (const m of content.matchAll(entry)) {
    const routePath = normalizePath(normalizeParams(m[1] ?? ""));
    if (!isPageRoute(routePath)) continue;
    routes.push(toRoute(routePath, webPhp));
  }
  return dedupeAndSort(routes);
}

/** True when a root-level Python manifest mentions the package. */
async function pythonDepDeclared(appRoot: string, pkg: RegExp): Promise<boolean> {
  const manifests = ["requirements.txt", "requirements-dev.txt", "pyproject.toml", "Pipfile"];
  for (const name of manifests) {
    const content = await readFile(join(appRoot, name), "utf8").catch(() => null);
    if (content && pkg.test(content)) return true;
  }
  return false;
}

/**
 * Detect + scan a server-rendered app's router. Returns null when nothing
 * recognizable is present, so `scanAppRoutes` can fall through to its
 * empty-result default.
 */
export async function scanServerRoutes(appRoot: string): Promise<ScanResult | null> {
  if (existsSync(join(appRoot, "manage.py"))) {
    return { framework: "django", routes: await scanDjango(appRoot), routesRoot: appRoot };
  }
  const routesRb = join(appRoot, "config", "routes.rb");
  if (existsSync(routesRb)) {
    return { framework: "rails", routes: await scanRails(routesRb), routesRoot: appRoot };
  }
  const webPhp = join(appRoot, "routes", "web.php");
  if (existsSync(join(appRoot, "artisan")) && existsSync(webPhp)) {
    return { framework: "laravel", routes: await scanLaravel(webPhp), routesRoot: appRoot };
  }
  if (await pythonDepDeclared(appRoot, /\b(flask|fastapi)\b/i)) {
    return {
      framework: "flask",
      routes: await scanPythonDecorators(appRoot),
      routesRoot: appRoot,
    };
  }
  return null;
}
