import { type Dirent, existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";

/**
 * Where a server-rendered app serves itself locally, and the stylesheets its
 * pages link — what an HTML/htmx design needs in `hostApp` before a single
 * `HtmlFragment` can show anything. Read from the running app when it answers,
 * otherwise from its source and the framework's default port.
 */
export interface HtmlHostDefaults {
  previewUrl: string;
  stylesheets?: string[];
}

const ENV_FILES = [".env", ".env.local", ".env.development", ".env.dev", ".env.example"];
const ENV_PORT = /^\s*(?:export\s+)?(?:[A-Z0-9_]*_)?PORT\s*=\s*["']?(\d{2,5})\b/m;
const SOURCE_PORTS = [
  // Go: a struct tag's default (caarlos0/env), a listen call, a server literal.
  /env:"[A-Z0-9_]*PORT[A-Z0-9_]*"[^`]*envDefault:"(\d{2,5})"/,
  /(?:ListenAndServe(?:TLS)?|\.Start|\.Run|\.Listen)\(\s*"[\w.-]*:(\d{2,5})"/,
  /\bAddr:\s*"[\w.-]*:(\d{2,5})"/,
  // Python: app.run(port=…), runserver 0.0.0.0:…
  /\.run\([^)]*\bport\s*=\s*(\d{2,5})/,
  /\brunserver\s+(?:[\d.]+:)?(\d{2,5})\b/,
];
const SOURCE_EXTENSIONS = new Set([".go", ".py", ".rb", ".php", ".templ"]);
const TEMPLATE_EXTENSIONS = new Set([
  ".html",
  ".htm",
  ".jinja",
  ".jinja2",
  ".j2",
  ".erb",
  ".php",
  ".tmpl",
  ".gohtml",
  ".hbs",
  ".go",
  ".templ",
]);
const SKIP_DIRS = new Set(["node_modules", "venv", ".venv", "env", "__pycache__", "vendor"]);
const MAX_FILES = 600;
const MAX_DEPTH = 6;
const PROBE_TIMEOUT_MS = 1_500;

/** The framework's own development port, by the entry file that names it. */
function defaultPort(appRoot: string): number {
  if (existsSync(join(appRoot, "manage.py")) || existsSync(join(appRoot, "artisan"))) return 8000;
  if (existsSync(join(appRoot, "config", "routes.rb"))) return 3000;
  if (existsSync(join(appRoot, "go.mod"))) return 8080;
  return 5000;
}

/** Source files under `appRoot` with one of `extensions`, in name order (bounded, tests skipped). */
function sourceFiles(appRoot: string, extensions: Set<string>): string[] {
  const files: string[] = [];
  const walk = (dir: string, depth: number) => {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
        a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
      );
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= MAX_FILES) return;
      if (entry.name.startsWith(".")) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && depth < MAX_DEPTH) walk(path, depth + 1);
      } else if (extensions.has(extname(entry.name)) && !/_test\.go$/.test(entry.name)) {
        files.push(path);
      }
    }
  };
  walk(appRoot, 0);
  return files;
}

const read = (path: string): string => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
};

/** The port the app listens on in development, as its env files or source say. */
export function detectHostPort(appRoot: string): number {
  for (const name of ENV_FILES) {
    const port = ENV_PORT.exec(read(join(appRoot, name)))?.[1];
    if (port) return Number(port);
  }
  for (const file of sourceFiles(appRoot, SOURCE_EXTENSIONS)) {
    const text = read(file);
    for (const pattern of SOURCE_PORTS) {
      const port = pattern.exec(text)?.[1];
      if (port) return Number(port);
    }
  }
  return defaultPort(appRoot);
}

const LINK_TAG = /<link\b[^>]*>/gi;
const attr = (tag: string, name: string): string | undefined =>
  new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(tag)?.slice(1).find(Boolean);

/** `hostApp.stylesheets` entries from a page's `<link rel="stylesheet">`s, resolved against `base`. */
export function stylesheetsInPage(html: string, base: URL): string[] {
  const sheets: string[] = [];
  for (const [tag] of html.matchAll(LINK_TAG)) {
    if (!/\bstylesheet\b/i.test(attr(tag, "rel") ?? "")) continue;
    const href = attr(tag, "href");
    if (!href) continue;
    let url: URL;
    try {
      url = new URL(href, base);
    } catch {
      continue;
    }
    // A same-origin query is a build's cache-buster: stale after the next build.
    const entry =
      url.origin === base.origin ? url.pathname : url.protocol === "https:" ? url.href : null;
    if (entry && !sheets.includes(entry)) sheets.push(entry);
  }
  return sheets;
}

const QUOTED_CSS = /["'](\/(?!\/)[^"'\s?]+\.css)(?:\?[^"'\s]*)?["']/g;
const FLASK_STATIC_CSS =
  /url_for\(\s*["']static["']\s*,\s*filename\s*=\s*["']([^"']+\.css)["']\s*\)/g;

/**
 * Stylesheets the app's templates or page code link, read from source for
 * when the app isn't running: a root-relative `.css` path on a line that
 * says "stylesheet", or Flask's `url_for('static', filename=…)`.
 */
function stylesheetsInSource(appRoot: string): string[] {
  const sheets: string[] = [];
  const add = (path: string) => {
    if (!sheets.includes(path)) sheets.push(path);
  };
  for (const file of sourceFiles(appRoot, TEMPLATE_EXTENSIONS)) {
    for (const line of read(file).split("\n")) {
      if (!/stylesheet/i.test(line)) continue;
      for (const [, path] of line.matchAll(QUOTED_CSS)) if (path) add(path);
      for (const [, name] of line.matchAll(FLASK_STATIC_CSS)) if (name) add(`/static/${name}`);
    }
  }
  return sheets;
}

/**
 * `hostApp.previewUrl` and `hostApp.stylesheets` for a server-rendered app.
 * `route` is the page the design starts from; its stylesheets are read from the
 * running app when it answers (following a sign-in redirect is fine — the
 * layout's head is shared), otherwise from source.
 */
export async function detectHtmlHost(
  appRoot: string,
  route = "/",
  get: typeof fetch = fetch,
): Promise<HtmlHostDefaults> {
  const origin = new URL(`http://127.0.0.1:${detectHostPort(appRoot)}`);
  let sheets: string[] = [];
  try {
    const response = await get(new URL(route, origin), {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (/text\/html/i.test(response.headers.get("content-type") ?? "")) {
      sheets = stylesheetsInPage(await response.text(), new URL(response.url || origin.href));
    }
  } catch {
    // Not running yet: the source is the next best witness.
  }
  if (sheets.length === 0) sheets = stylesheetsInSource(appRoot);
  return {
    previewUrl: origin.origin,
    ...(sheets.length > 0 ? { stylesheets: sheets } : {}),
  };
}
