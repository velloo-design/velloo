import { type Dirent, readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";

// The stylesheets a server-rendered app's pages link, read from its templates:
// what an HTML design keeps copies of, to look like the app without it running.

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

const QUOTED_CSS = /["'](\/(?!\/)[^"'\s?]+\.css)(?:\?[^"'\s]*)?["']/g;
const FLASK_STATIC_CSS =
  /url_for\(\s*["']static["']\s*,\s*filename\s*=\s*["']([^"']+\.css)["']\s*\)/g;

/**
 * Stylesheets the app's templates or page code link: a root-relative `.css` path on a line that
 * says "stylesheet", or Flask's `url_for('static', filename=…)`.
 */
export function stylesheetsInSource(appRoot: string): string[] {
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
