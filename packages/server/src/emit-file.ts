/**
 * Where an emitted page may be written in the host app, and what it is called
 * there — the half of `emit_code { file }` / `velloo emit --to page.tsx` that
 * touches the app, kept in one place so the two cannot disagree.
 *
 * Writing into the app is the one thing emit otherwise never does, so the
 * rules are narrow: a source file inside the app root, never under
 * `node_modules`, a dot-directory or the design folder, and never over a file
 * that is already there unless the caller says so.
 */
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";

const JSX_FILE = /\.(jsx|tsx|js)$/;
const MARKUP_FILE = /\.(html?|jinja2?|j2|njk|twig|liquid|hbs|mustache|ejs|erb|tmpl|gohtml)$/;
/** Past this an existing file is not read back for its export; it is still there. */
const MAX_EXISTING_BYTES = 512 * 1024;

export interface PageFile {
  /** Absolute path the page is written to. */
  path: string;
  /** The same path as the app spells it, relative to its root, `/`-separated. */
  relative: string;
  /** What is at the path now, or null when nothing is. */
  existing: string | null;
  typescript: boolean;
}

/**
 * `path` with every symlink in the part of it that exists resolved — the file
 * itself may not exist yet, nor the folders it goes in.
 */
function realPath(path: string): string {
  const missing: string[] = [];
  for (let dir = path; ; dir = dirname(dir)) {
    try {
      return join(realpathSync(dir), ...missing);
    } catch {
      if (dirname(dir) === dir) return path;
      missing.unshift(basename(dir));
    }
  }
}

/**
 * Resolve the file an emit was asked to write, or say why it may not be
 * written. `format` is what the screen emits as: JSX goes in a script module,
 * native markup in a template.
 */
export function pageFileFor(
  hostRoot: string,
  designRoot: string,
  given: string,
  format: "jsx" | "html",
): { ok: true; file: PageFile } | { ok: false; reason: string } {
  const no = (reason: string) => ({ ok: false as const, reason });
  // An absolute path is how an agent's own file tools spell it; it may reach
  // the app through a symlink (`/tmp` on macOS) the app root was resolved past.
  const asked = isAbsolute(given) ? resolve(given) : resolve(hostRoot, given);
  const lexical = relative(hostRoot, asked);
  const path = lexical.startsWith("..") || isAbsolute(lexical) ? realPath(asked) : asked;
  const inApp = relative(hostRoot, path);
  if (inApp === "" || inApp.startsWith("..") || isAbsolute(inApp)) {
    return no("`file` is a path inside the app, relative to the app root");
  }
  const segments = inApp.split(sep);
  if (segments.includes("node_modules") || segments.some((part) => part.startsWith("."))) {
    return no("`file` cannot be under node_modules or a dot-directory");
  }
  // A symlinked directory inside the app must not carry the write out of it.
  const real = realPath(path);
  if (!real.startsWith(hostRoot + sep)) return no("`file` resolves outside the app");
  const design = realPath(designRoot);
  if (real.startsWith(design + sep)) {
    return no("`file` is inside the design folder, which only Velloo's operations write");
  }
  if (!(format === "jsx" ? JSX_FILE : MARKUP_FILE).test(path)) {
    return no(
      format === "jsx"
        ? "this screen emits JSX: `file` is a .jsx or .tsx module"
        : `this screen emits markup: \`file\` is a template (${extname(path) || "no extension"} is not one)`,
    );
  }
  let existing: string | null = null;
  if (existsSync(path)) {
    const stat = statSync(path);
    if (!stat.isFile()) return no("`file` is not a file");
    existing = stat.size <= MAX_EXISTING_BYTES ? readFileSync(path, "utf8") : "";
  }
  return {
    ok: true,
    file: {
      path,
      relative: segments.join("/"),
      existing,
      typescript: path.endsWith(".tsx"),
    },
  };
}

/**
 * A page file that is only a place for a page: a few lines whose component
 * returns null. A router's scaffold leaves these, and there is nothing in one
 * to lose — unlike any file with markup or logic in it, which is somebody's.
 */
export function rendersNothing(source: string): boolean {
  const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
  const lines = code.split("\n").filter((line) => line.trim() !== "");
  return lines.length <= 8 && /\breturn\s+null\b/.test(code) && !/<\/|\/>/.test(code);
}

/** File names that say where a page sits, not what it is. */
const ROUTE_FILE = /^(page|index|route|layout|default|template|main|app)$/i;

function pascal(text: string): string {
  const name = text
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
  return /^[A-Z]/.test(name) ? name : `Page${name}`;
}

/**
 * The component a page file exports. A file being replaced keeps the export it
 * had — the route or the import that reaches it goes on working — and a new
 * one is named for its file, or for the screen where the file name is only a
 * router convention (`page.tsx`).
 */
export function pageExportFor(
  file: Pick<PageFile, "path" | "existing">,
  screenName: string,
): { name: string; defaultExport: boolean } {
  const source = file.existing ?? "";
  const byDefault =
    /export\s+default\s+(?:async\s+)?function\s+([A-Z]\w*)/.exec(source)?.[1] ??
    /export\s+default\s+([A-Z]\w*)\s*;?\s*$/m.exec(source)?.[1];
  if (byDefault) return { name: byDefault, defaultExport: true };
  if (!/export\s+default\b/.test(source)) {
    const named = [...source.matchAll(/export\s+(?:async\s+)?(?:function|const)\s+([A-Z]\w*)/g)];
    if (named.length === 1 && named[0]?.[1]) return { name: named[0][1], defaultExport: false };
  }
  const stem = basename(file.path, extname(file.path));
  return { name: pascal(ROUTE_FILE.test(stem) ? screenName : stem), defaultExport: true };
}

/** An import known relative to the app root, as a module at `path` spells it. */
export function importFromAppRoot(hostRoot: string, path: string, specifier: string): string {
  const to = relative(dirname(path), resolve(hostRoot, specifier)).split(sep).join("/");
  return to.startsWith(".") ? to : `./${to}`;
}

/** `@scope/pkg/sub` → `@scope/pkg`; null for an alias or a relative path. */
function packageOf(specifier: string): string | null {
  if (/^(\.|\/|@\/|~\/|#)/.test(specifier)) return null;
  const [first, second] = specifier.split("/");
  if (!first) return null;
  return first.startsWith("@") ? (second ? `${first}/${second}` : null) : first;
}

/**
 * The packages among `imports` that no `package.json` between the file and
 * the app root declares — a page that imports one doesn't build. Empty where
 * the app has no `package.json` at all: nothing to check against.
 */
export function undeclaredPackages(hostRoot: string, path: string, imports: string[]): string[] {
  const declared = new Set<string>();
  let manifests = 0;
  for (let dir = dirname(path); ; dir = dirname(dir)) {
    try {
      const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as Record<
        string,
        Record<string, string> | undefined
      >;
      manifests += 1;
      for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
        for (const name of Object.keys(manifest[field] ?? {})) declared.add(name);
      }
    } catch {
      // No manifest at this level, or one that isn't JSON.
    }
    if (dir === hostRoot || dirname(dir) === dir) break;
  }
  if (manifests === 0) return [];
  const packages = new Set(imports.map(packageOf).filter((name): name is string => name !== null));
  return [...packages].filter((name) => name !== "react" && !declared.has(name)).sort();
}
