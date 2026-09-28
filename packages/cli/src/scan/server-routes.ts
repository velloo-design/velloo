import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { idFromRoutePath, nameFromRoutePath } from "./route-names.ts";
import type { ScannedRoute, ScanResult } from "./types.ts";

/**
 * Best-effort route extraction for server-rendered apps (Django / Flask /
 * FastAPI / Rails / Laravel / Go). Velloo's scan only needs the route *shape* to
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

/** `:id` (echo, gin, fiber), `{id}` / `{id:[0-9]+}` (chi, net/http) → `[id]`; wildcards dropped. */
function normalizeGoParams(path: string): string {
  return path
    .replace(/:(\w+)/g, "[$1]")
    .replace(/\{(\w+)(?::[^}]*)?\}/g, "[$1]")
    .replace(/\/\*\w*$/, "")
    .replace(/\{\$\}$/, "");
}

/** A parameter type that is a router or route group in the common Go web frameworks. */
const GO_ROUTER_TYPE =
  /^\*?(?:echo\.(?:Echo|Group)|gin\.(?:Engine|RouterGroup|IRouter|IRoutes)|chi\.(?:Router|Mux)|fiber\.(?:App|Router)|http\.ServeMux|mux\.Router)$/;
const GO_GET = /\b(\w+)\.(?:GET|Get)\(\s*"((?:\/[^"]*)?)"/g;
const GO_GROUP = /\b(\w+)\s*:?=\s*(\w+)\.(?:Group|PathPrefix)\(\s*"([^"]*)"/g;
const GO_ROUTE_CLOSURE = /\b(\w+)\.(?:Route|Group)\(\s*"([^"]*)"\s*,\s*func\s*\(\s*(\w+)/g;
const GO_HANDLE = /\b(\w+)\.(?:HandleFunc|Handle)\(\s*"(?:GET\s+)?(\/[^"]*)"/g;
const GO_FUNC = /\bfunc\s+(?:\([^)]*\)\s*)?(\w+)\s*\(([^)]*)\)/g;
const GO_CALL = /\b(?:(\w+)\.)?(\w+)\(/g;
const GO_FUNC_HEAD = /^func\s+(?:\([^)]*\)\s*)?(\w+)\s*\(/;

/** The top-level, comma-separated arguments of the call whose `(` ends at `open`. */
function goCallArgs(text: string, open: number): string[] {
  const args: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = open;
  for (let i = open; i < text.length; i++) {
    const char = text[i];
    if (quote) {
      if (char === quote && text[i - 1] !== "\\") quote = null;
    } else if (char === '"' || char === "`") quote = char;
    else if (char === "(" || char === "{" || char === "[") depth++;
    else if (char === ")" || char === "}" || char === "]") {
      if (depth === 0) {
        args.push(text.slice(start, i).trim());
        return args;
      }
      depth--;
    } else if (char === "," && depth === 0) {
      args.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  return args;
}

interface GoRef {
  /** A variable in this scope, or a router parameter of a function. */
  base: { kind: "var" | "param"; key: string } | null;
  path: string;
}

/**
 * Go (echo, gin, chi, fiber, net/http, gorilla/mux): GET registrations, with
 * the prefixes of the groups they hang off — a local `g := e.Group("/admin")`,
 * a chi `r.Route("/admin", func(r chi.Router) { … })`, or a group handed to a
 * package's function (`auth.MountRouter(authGroup)` → `parent.GET("/login")`
 * in `auth/`). Package-qualified calls are matched to their directory by the
 * import alias, the usual last path segment.
 */
async function scanGo(appRoot: string): Promise<ScannedRoute[]> {
  const files = await collectFiles(
    appRoot,
    (n) => n.endsWith(".go") && !n.endsWith("_test.go"),
    7,
    800,
  );
  const vars = new Map<string, GoRef>(); // `${file}#${scope}#${name}`
  const params = new Map<string, number[]>(); // `${pkg}.${func}` → router param indexes
  const paramNames = new Map<string, string[]>();
  const paramRefs = new Map<string, GoRef>(); // `${pkg}.${func}#${index}` → caller's argument
  const routes: { file: string; ref: GoRef }[] = [];
  const parsed: { file: string; pkg: string; content: string }[] = [];

  for (const file of files) {
    const content = await readFile(file, "utf8").catch(() => null);
    if (!content) continue;
    const pkg = basename(dirname(file));
    parsed.push({ file, pkg, content });
    for (const m of content.matchAll(GO_FUNC)) {
      const list = (m[2] ?? "").split(",").map((p) => p.trim().split(/\s+/));
      paramNames.set(
        `${pkg}.${m[1]}`,
        list.map((parts) => parts[0] ?? ""),
      );
      const indexes = list.flatMap((parts, i) =>
        GO_ROUTER_TYPE.test(parts.at(-1) ?? "") ? [i] : [],
      );
      if (indexes.length > 0) params.set(`${pkg}.${m[1]}`, indexes);
    }
  }

  for (const { file, pkg, content } of parsed) {
    // Scopes: 0 is the file; a chi closure opens a scope that ends with its brace.
    const scopes: { id: number; depth: number; parent: number }[] = [
      { id: 0, depth: -1, parent: -1 },
    ];
    let nextScope = 1;
    let depth = 0;
    let func: { name: string; params: string[] } | null = null;
    const lookup = (name: string): GoRef["base"] => {
      for (let i = scopes.length - 1; i >= 0; i--) {
        const scope = scopes[i];
        const key = `${file}#${scope?.id}#${name}`;
        if (scope && vars.has(key)) return { kind: "var", key };
      }
      const index = func?.params.indexOf(name) ?? -1;
      if (func && index >= 0 && params.get(`${pkg}.${func.name}`)?.includes(index)) {
        return { kind: "param", key: `${pkg}.${func.name}#${index}` };
      }
      return null;
    };
    const current = () => scopes[scopes.length - 1]?.id ?? 0;
    for (const line of content.split("\n")) {
      const header = depth === 0 ? line.match(GO_FUNC_HEAD) : null;
      if (header) {
        const name = header[1] ?? "";
        func = { name, params: paramNames.get(`${pkg}.${name}`) ?? [] };
      }
      for (const m of line.matchAll(GO_GROUP)) {
        vars.set(`${file}#${current()}#${m[1]}`, { base: lookup(m[2] ?? ""), path: m[3] ?? "" });
      }
      for (const m of line.matchAll(GO_GET)) {
        routes.push({ file, ref: { base: lookup(m[1] ?? ""), path: m[2] ?? "" } });
      }
      for (const m of line.matchAll(GO_HANDLE)) {
        routes.push({ file, ref: { base: lookup(m[1] ?? ""), path: m[2] ?? "" } });
      }
      for (const m of line.matchAll(GO_CALL)) {
        const key = `${m[1] ?? pkg}.${m[2]}`;
        const indexes = params.get(key);
        if (!indexes || m.index === undefined) continue;
        const args = goCallArgs(line, m.index + m[0].length);
        for (const index of indexes) {
          const arg = args[index] ?? "";
          const inline = arg.match(/^(\w+)\.(?:Group|PathPrefix)\(\s*"([^"]*)"/);
          if (inline) {
            paramRefs.set(`${key}#${index}`, {
              base: lookup(inline[1] ?? ""),
              path: inline[2] ?? "",
            });
          } else if (/^\w+$/.test(arg)) {
            paramRefs.set(`${key}#${index}`, { base: lookup(arg), path: "" });
          }
        }
      }
      const closure = [...line.matchAll(GO_ROUTE_CLOSURE)][0];
      const opened = (line.match(/\{/g) ?? []).length;
      const closed = (line.match(/\}/g) ?? []).length;
      if (closure) {
        const id = nextScope++;
        scopes.push({ id, depth, parent: current() });
        vars.set(`${file}#${id}#${closure[3]}`, {
          base: lookup(closure[1] ?? ""),
          path: closure[2] ?? "",
        });
      }
      depth += opened - closed;
      while (scopes.length > 1 && depth <= (scopes[scopes.length - 1]?.depth ?? -1)) scopes.pop();
      // A function ends where its body closes — not on a signature line
      // that opens no brace yet.
      if (depth <= 0 && closed > 0) func = null;
      if (depth < 0) depth = 0;
    }
  }

  const prefixOf = (ref: GoRef, seen = new Set<string>()): string => {
    const base = ref.base;
    if (!base) return ref.path;
    const key = base.key;
    if (seen.has(key)) return ref.path;
    seen.add(key);
    const parent = base.kind === "var" ? vars.get(key) : paramRefs.get(key);
    return `${parent ? prefixOf(parent, seen) : ""}/${ref.path}`;
  };
  const out: ScannedRoute[] = [];
  for (const { file, ref } of routes) {
    const routePath = normalizePath(normalizeGoParams(prefixOf(ref)).replace(/\/+/g, "/"));
    // `/admin` is Django's built-in admin elsewhere; in a Go app it's the app's own UI.
    const first = routePath.split("/").filter(Boolean)[0] ?? "";
    if (first === "api" || first === "static" || /[*]/.test(routePath)) continue;
    out.push(toRoute(routePath, file));
  }
  return dedupeAndSort(out);
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

// Go apps keep their markup in source (html/template strings, templ).
const TEMPLATE_FILE = /\.(?:html?|jinja2?|j2|erb|php|tmpl|gohtml|hbs|templ)$|(?<!_test)\.go$/;
const LINK_URL = /\bhref\s*=\s*["']([^"']+)["']/g;
const FRAGMENT_URL =
  /\b(?:hx-(?:get|post|put|patch|delete)|action|formaction)\s*=\s*["']([^"']+)["']/g;

/** A template URL's path as segments, template expressions (`{{ id }}`, `<%= %>`) as wildcards. */
function urlSegments(url: string): string[] | null {
  const path = url.split(/[?#]/)[0] ?? "";
  if (!path.startsWith("/") || path.startsWith("//")) return null;
  return path
    .replace(/\{\{.*?\}\}|\{%.*?%\}|<%.*?%>|<\?.*?\?>|%[sdv]/g, "*")
    .split("/")
    .filter(Boolean);
}

function routeMatches(routePath: string, url: string[]): boolean {
  const route = routePath.split("/").filter(Boolean);
  if (route.length !== url.length) return false;
  return route.every(
    (segment, i) =>
      segment.startsWith("[") || url[i] === "*" || url[i]?.includes("*") || segment === url[i],
  );
}

/**
 * Drop htmx fragment endpoints: routes the templates reach only through
 * `hx-*` requests or form actions, never an `href`. Those return partials
 * (`/videos/cancel_add/<cat>`), not pages worth a screen. A route no template
 * names literally (Django's `{% url %}`) is kept — nothing says it's a fragment.
 */
async function withoutFragmentRoutes(
  appRoot: string,
  routes: ScannedRoute[],
): Promise<ScannedRoute[]> {
  const links: string[][] = [];
  const fragments: string[][] = [];
  for (const file of await collectFiles(appRoot, (n) => TEMPLATE_FILE.test(n))) {
    const content = await readFile(file, "utf8").catch(() => null);
    if (!content) continue;
    for (const [pattern, into] of [
      [LINK_URL, links],
      [FRAGMENT_URL, fragments],
    ] as const) {
      for (const m of content.matchAll(pattern)) {
        const segments = urlSegments(m[1] ?? "");
        if (segments) into.push(segments);
      }
    }
  }
  return routes.filter(
    (route) =>
      route.routePath === "/" ||
      links.some((url) => routeMatches(route.routePath, url)) ||
      !fragments.some((url) => routeMatches(route.routePath, url)),
  );
}

/**
 * Detect + scan a server-rendered app's router. Returns null when nothing
 * recognizable is present, so `scanAppRoutes` can fall through to its
 * empty-result default.
 */
export async function scanServerRoutes(appRoot: string): Promise<ScanResult | null> {
  if (existsSync(join(appRoot, "manage.py"))) {
    return {
      framework: "django",
      routes: await withoutFragmentRoutes(appRoot, await scanDjango(appRoot)),
      routesRoot: appRoot,
    };
  }
  const routesRb = join(appRoot, "config", "routes.rb");
  if (existsSync(routesRb)) {
    return {
      framework: "rails",
      routes: await withoutFragmentRoutes(appRoot, await scanRails(routesRb)),
      routesRoot: appRoot,
    };
  }
  const webPhp = join(appRoot, "routes", "web.php");
  if (existsSync(join(appRoot, "artisan")) && existsSync(webPhp)) {
    return {
      framework: "laravel",
      routes: await withoutFragmentRoutes(appRoot, await scanLaravel(webPhp)),
      routesRoot: appRoot,
    };
  }
  if (existsSync(join(appRoot, "go.mod"))) {
    const routes = await scanGo(appRoot);
    if (routes.length > 0) {
      return {
        framework: "go",
        routes: await withoutFragmentRoutes(appRoot, routes),
        routesRoot: appRoot,
      };
    }
  }
  if (await pythonDepDeclared(appRoot, /\b(flask|fastapi)\b/i)) {
    return {
      framework: "flask",
      routes: await withoutFragmentRoutes(appRoot, await scanPythonDecorators(appRoot)),
      routesRoot: appRoot,
    };
  }
  return null;
}
