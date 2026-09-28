import { type Dirent, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";

/**
 * Server-rendered (non-JS-framework) app signals, shared by `looksLikeUiApp`
 * and `detectHost`: a server entry file next to a template directory means
 * the pages are HTML the server writes, whatever the language.
 */

const SERVER_ENTRIES = [
  "manage.py",
  "app.py",
  "main.py",
  "app/main.py",
  "config/routes.rb",
  "artisan",
  "go.mod",
];
const TEMPLATE_DIRS = ["templates", "app/templates", "resources/views", "app/views", "views"];
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
]);
/** Go apps write their pages in code: html/template strings, templ, gomponents. */
const GO_SOURCE_EXTENSIONS = new Set([".go", ".templ"]);
/** Go modules that only an app writing htmx pages depends on. */
const GO_HTML_MODULE = /^\s*(?:require\s+)?\S*(?:htmx|a-h\/templ|gomponents)\S*\s+v/im;
const SKIP_DIRS = new Set([
  "node_modules",
  "venv",
  ".venv",
  "env",
  "__pycache__",
  "vendor",
  "testdata",
]);
const MAX_TEMPLATE_FILES = 200;
const MAX_DEPTH = 4;
const HTMX_MARKUP =
  /\bhx-(?:get|post|put|patch|delete|boost|target|swap|trigger)\b|htmx(?:\.org)?(?:@[\d.]+)?(?:\/dist)?\/?(?:htmx)?(?:\.min)?\.js/i;

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * The app's template directories: the conventional roots, plus a `templates/`
 * one package down (Django apps, Flask packages).
 */
function serverTemplateDirs(appRoot: string): string[] {
  const dirs = TEMPLATE_DIRS.map((rel) => join(appRoot, rel)).filter(isDir);
  let entries: string[] = [];
  try {
    entries = readdirSync(appRoot);
  } catch {
    return dirs;
  }
  for (const name of entries) {
    if (name.startsWith(".") || SKIP_DIRS.has(name)) continue;
    const nested = join(appRoot, name, "templates");
    if (!dirs.includes(nested) && isDir(nested)) dirs.push(nested);
  }
  return dirs;
}

/** A server entry file beside templates — pages the server renders as HTML. */
export function isServerRenderedApp(appRoot: string): boolean {
  return (
    SERVER_ENTRIES.some((rel) => existsSync(join(appRoot, rel))) &&
    serverTemplateDirs(appRoot).length > 0
  );
}

/** Whether any template (or a root-level `.html` page) uses htmx — bounded walk. */
export function hasHtmxMarkup(appRoot: string): boolean {
  let budget = MAX_TEMPLATE_FILES;
  const matches = (file: string): boolean => {
    budget--;
    try {
      return HTMX_MARKUP.test(readFileSync(file, "utf8"));
    } catch {
      return false;
    }
  };
  const walk = (dir: string, depth: number, extensions = TEMPLATE_EXTENSIONS): boolean => {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return false;
    }
    for (const entry of entries) {
      if (budget <= 0) return false;
      if (entry.name.startsWith(".")) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && depth < MAX_DEPTH && walk(path, depth + 1, extensions)) {
          return true;
        }
      } else if (
        extensions.has(extname(entry.name)) &&
        !entry.name.endsWith("_test.go") &&
        matches(path)
      ) {
        return true;
      }
    }
    return false;
  };
  try {
    for (const name of readdirSync(appRoot)) {
      if (extname(name) === ".html" && matches(join(appRoot, name))) return true;
    }
  } catch {
    return false;
  }
  if (serverTemplateDirs(appRoot).some((dir) => walk(dir, 0))) return true;
  const goMod = join(appRoot, "go.mod");
  if (!existsSync(goMod)) return false;
  // A Go htmx helper or component library in the module is the cheap signal;
  // otherwise read the source, where Go apps keep their markup.
  try {
    if (GO_HTML_MODULE.test(readFileSync(goMod, "utf8"))) return true;
  } catch {
    return false;
  }
  budget = MAX_TEMPLATE_FILES * 3;
  return walk(appRoot, 0, GO_SOURCE_EXTENSIONS);
}
