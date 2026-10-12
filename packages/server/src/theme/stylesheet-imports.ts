import { readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";

/**
 * A stylesheet with the stylesheets it `@import`s by relative path written in
 * where it names them.
 *
 * An app's global stylesheet is often only an entry point — `@import
 * "tailwindcss"; @import "./theme.css";` — with every token in the file beside
 * it. The theme parser reads text, so handed the entry alone it finds nothing
 * and the app is themed with a preset. Only files are followed: a package
 * (`tailwindcss`, `@acme/theme/x.css`), a URL and a site-root path all stay as
 * the sheet wrote them, and nothing is resolved through `node_modules`.
 */
export interface ExpandedStylesheet {
  css: string;
  /** The stylesheets written in, absolute, in the order they were read. */
  followed: string[];
  /** Relative imports that were left as written, and why. */
  skipped: SkippedImport[];
}

interface SkippedImport {
  specifier: string;
  /** The stylesheet that names it, absolute. */
  from: string;
  reason: string;
}

/** An entry sheet importing a tokens file importing a palette is three; past this it is a loop in all but name. */
const MAX_DEPTH = 5;
const MAX_FILES = 32;
/** A hand-written token sheet is a few kilobytes; a megabyte is a build artifact. */
const MAX_BYTES = 1024 * 1024;

/** `@import "x"`, `@import url(x)`, and whatever follows up to the `;`. */
const IMPORT_RE = /@import\s+(?:url\(\s*)?(?:"([^"]*)"|'([^']*)'|([^\s;"')]+))\s*\)?([^;{}]*);/g;

/** What may trail an import without making it conditional: a cascade layer, and Tailwind v4's own modifiers. */
const UNCONDITIONAL_SUFFIX = /\b(?:layer|theme|source|prefix)\([^)]*\)|\b(?:layer|important)\b/g;

/** Comments replaced by spaces of the same length, so an offset into the result is an offset into `css`. */
function blankComments(css: string): string {
  let out = "";
  let from = 0;
  for (;;) {
    const open = css.indexOf("/*", from);
    if (open === -1) return out + css.slice(from);
    const close = css.indexOf("*/", open + 2);
    const end = close === -1 ? css.length : close + 2;
    out += css.slice(from, open) + " ".repeat(end - open);
    from = end;
  }
}

function inside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel !== "" && !isAbsolute(rel) && !rel.split(sep).includes("..");
}

/**
 * The file a specifier names beside its importer, or null when it names
 * something else. `theme.css` with no `./` is a relative URL in CSS and a
 * package to a bundler; it is followed only when that file is really there.
 */
function relativeTarget(
  specifier: string,
  importer: string,
): { path: string; bare: boolean } | null {
  const path = specifier.split(/[?#]/)[0] ?? "";
  if (path === "" || path.startsWith("/") || path.startsWith("@")) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return null;
  const explicit = path.startsWith("./") || path.startsWith("../");
  if (!explicit && extname(path).toLowerCase() !== ".css") return null;
  return { path: resolve(dirname(importer), path), bare: !explicit };
}

/**
 * Follow `entryPath`'s relative `@import`s, staying inside `root`.
 *
 * `root` is the app: an import that leaves it — by `../` or through a symlink
 * — is not read, so a checked-out repo cannot make Velloo read a file outside
 * itself. `css` is the entry's text when the caller has already read it.
 */
export function expandStylesheetImports(
  entryPath: string,
  opts: { root: string; css?: string },
): ExpandedStylesheet {
  const followed: string[] = [];
  const skipped: SkippedImport[] = [];
  let css = opts.css;
  if (css === undefined) {
    try {
      css = readFileSync(entryPath, "utf8");
    } catch {
      return { css: "", followed, skipped };
    }
  }
  let root: string;
  let entry: string;
  try {
    root = realpathSync(opts.root);
    entry = realpathSync(entryPath);
  } catch {
    return { css, followed, skipped };
  }

  // Containment and cycles are decided on real paths; what is reported is the
  // path as the app spells it, which is what a person can find.
  let reads = 0;
  const expand = (text: string, file: string, stack: readonly string[]): string => {
    const scanned = blankComments(text);
    let out = "";
    let from = 0;
    for (const match of scanned.matchAll(IMPORT_RE)) {
      const specifier = match[1] ?? match[2] ?? match[3] ?? "";
      const target = relativeTarget(specifier, file);
      if (target === null) continue;
      const skip = (reason: string): void => {
        skipped.push({ specifier, from: file, reason });
      };

      let real: string;
      try {
        real = realpathSync(target.path);
      } catch {
        // A bare name with no file beside the sheet is a package, not a miss.
        if (!target.bare) skip("no such file");
        continue;
      }
      if (extname(real).toLowerCase() !== ".css") {
        skip("not a .css file");
        continue;
      }
      if (!inside(root, real) || real.split(sep).includes("node_modules")) {
        skip("outside the app root");
        continue;
      }
      if (stack.includes(real)) continue;
      const condition = (match[4] ?? "").replace(UNCONDITIONAL_SUFFIX, "").trim();
      if (/\bsupports\(/.test(condition)) {
        skip("imported under a supports() condition");
        continue;
      }
      if (stack.length > MAX_DEPTH) {
        skip(`nested more than ${MAX_DEPTH} imports deep`);
        continue;
      }
      if (reads >= MAX_FILES) {
        skip(`more than ${MAX_FILES} imported stylesheets`);
        continue;
      }
      let imported: string;
      try {
        if (statSync(real).size > MAX_BYTES) {
          skip("larger than 1 MB");
          continue;
        }
        imported = readFileSync(real, "utf8");
      } catch {
        skip("unreadable");
        continue;
      }
      reads++;
      if (!followed.includes(target.path)) followed.push(target.path);
      const body = expand(imported, target.path, [...stack, real]);
      // A sheet imported for a medium keeps it: `@import "./dark.css"
      // (prefers-color-scheme: dark)` holds the dark palette, not the light one.
      out += `${text.slice(from, match.index)}${condition ? `@media ${condition} {\n${body}\n}` : body}\n`;
      from = match.index + match[0].length;
    }
    return out + text.slice(from);
  };

  return { css: expand(css, entryPath, [entry]), followed, skipped };
}
