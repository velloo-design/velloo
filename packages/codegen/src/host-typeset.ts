import { type Dirent, readdirSync, readFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { TYPESET_SCALE_NAMES } from "@velloo/schema";
import { detectTailwindMajor } from "./detect-tailwind.ts";
import { configThemeKeys } from "./import-theme/parse-tailwind-config.ts";
import { type V3ClassIssue, v3ClassIssues } from "./tailwind-compat.ts";

/**
 * Whether a host app can compile the typeset utilities (`text-body`,
 * `leading-h1`, `tracking-h1`, …) the Heading/Text helpers lower to. Those are
 * not stock Tailwind: they exist only once `emit_theme` has written the
 * typeset tokens into the app (v4 `@theme`, v3 the velloo preset). An app that
 * never ran it gets classes that compile to nothing — silently, since Tailwind
 * ignores an unknown class — so emit says so instead.
 *
 * Detection reads the app's own sources, never evaluates them: `@theme` blocks
 * in its stylesheets (v4) and the `fontSize` / `lineHeight` / `letterSpacing`
 * keys of its tailwind config plus the local modules it imports (v3 presets).
 */

type TypesetNamespace = "text" | "leading" | "tracking";

const CONFIG_KEY: Record<TypesetNamespace, string> = {
  text: "fontSize",
  leading: "lineHeight",
  tracking: "letterSpacing",
};

const ROLES: ReadonlySet<string> = new Set(TYPESET_SCALE_NAMES);
const TYPESET_UTILITY = /^(text|leading|tracking)-([a-z0-9]+)$/;
const CONFIG_NAMES = ["ts", "js", "mjs", "cjs", "mts", "cts"].map((e) => `tailwind.config.${e}`);
const MODULE_EXTENSIONS = ["", ".ts", ".js", ".mjs", ".cjs", ".mts", ".cts"];
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "out", "coverage"]);
const MAX_DEPTH = 6;

/** `md:hover:!tracking-h1` → `tracking-h1`, or null when it isn't a typeset utility. */
function typesetToken(cls: string): string | null {
  const base = cls.slice(cls.lastIndexOf(":") + 1).replace(/^!|!$/g, "");
  const m = TYPESET_UTILITY.exec(base);
  return m && ROLES.has(m[2] as string) ? base : null;
}

function read(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/** Relative module specifiers a config imports or requires — where a preset lives. */
function localImports(src: string): string[] {
  const specs = new Set<string>();
  for (const m of src.matchAll(
    /(?:from\s+|require\s*\(\s*|import\s*\(\s*)["'`](\.{1,2}\/[^"'`]+)["'`]/g,
  )) {
    specs.add(m[1] as string);
  }
  return [...specs];
}

function addConfigTokens(src: string, into: Set<string>): void {
  for (const [ns, key] of Object.entries(CONFIG_KEY)) {
    for (const role of configThemeKeys(src, key)) into.add(`${ns}-${role}`);
  }
}

/** Tokens a tailwind config (and the local modules it imports, one level) declares. */
function configTokens(appRoot: string, into: Set<string>): void {
  for (const name of CONFIG_NAMES) {
    const src = read(join(appRoot, name));
    if (src === null) continue;
    addConfigTokens(src, into);
    for (const spec of localImports(src)) {
      const base = resolve(appRoot, spec);
      for (const ext of MODULE_EXTENSIONS) {
        const imported = read(`${base}${ext}`);
        if (imported !== null) {
          addConfigTokens(imported, into);
          break;
        }
      }
    }
  }
}

/** The body of every `@theme { … }` block (`@theme inline`, `@theme static` included). */
function themeBlocks(css: string): string[] {
  const blocks: string[] = [];
  for (const m of css.matchAll(/@theme\b[^{;]*\{/g)) {
    const open = (m.index as number) + m[0].length - 1;
    let depth = 0;
    for (let i = open; i < css.length; i++) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}" && --depth === 0) {
        blocks.push(css.slice(open + 1, i));
        break;
      }
    }
  }
  return blocks;
}

function cssTokens(dir: string, ignore: readonly string[], depth: number, into: Set<string>): void {
  if (depth > MAX_DEPTH || ignore.some((p) => dir === p || dir.startsWith(`${p}${sep}`))) return;
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) cssTokens(path, ignore, depth + 1, into);
    } else if (entry.isFile() && entry.name.endsWith(".css")) {
      const css = read(path);
      if (css === null || !css.includes("@theme")) continue;
      for (const block of themeBlocks(css)) {
        for (const m of block.matchAll(/--(text|leading|tracking)-([a-z0-9]+)\s*:/g)) {
          into.add(`${m[1]}-${m[2]}`);
        }
      }
    }
  }
}

/**
 * The typeset utilities among `classes` that the app at `appRoot` doesn't
 * define, deduped and in first-seen order (variants stripped). `ignore` lists
 * directories to leave out of the stylesheet scan — the design folder, whose
 * CSS the app never compiles.
 */
export function missingTypesetUtilities(
  appRoot: string,
  classes: Iterable<string>,
  ignore: readonly string[] = [],
): string[] {
  const used: string[] = [];
  for (const cls of classes) {
    const token = typesetToken(cls);
    if (token !== null && !used.includes(token)) used.push(token);
  }
  if (used.length === 0) return [];
  const defined = new Set<string>();
  configTokens(appRoot, defined);
  cssTokens(
    resolve(appRoot),
    ignore.map((p) => resolve(p)),
    0,
    defined,
  );
  return used.filter((token) => !defined.has(token));
}

function typesetWarning(missing: readonly string[], major: 3 | 4): string {
  const list = missing.map((c) => `\`${c}\``).join(", ");
  const where =
    major === 3 ? "the velloo preset + velloo-typeset.css" : "the `@theme` tokens + typeset.css";
  return `${list} ${missing.length === 1 ? "is a typeset utility" : "are typeset utilities"} (the Heading/Text type ladder) that this Tailwind v${major} app doesn't define, so ${missing.length === 1 ? "it compiles" : "they compile"} to nothing. Run \`emit_theme\` (CLI: \`velloo theme export\`) against the app to add them (${where}), or swap in the app's own type classes.`;
}

export interface HostTailwindAdvisory {
  /** v4→v3 renames — only on a v3 host. */
  v3Compat: V3ClassIssue[];
  /** Caveats for the emit's `warnings`. */
  warnings: string[];
}

/**
 * Everything a Tailwind-channel emit should tell the agent about the host app
 * it is writing into: the v4→v3 renames, and typeset utilities the app lacks.
 * Empty when the app doesn't declare Tailwind at all.
 */
export function hostTailwindAdvisory(
  appRoot: string,
  classes: readonly string[],
  ignore: readonly string[] = [],
): HostTailwindAdvisory {
  const major = detectTailwindMajor(appRoot);
  if (major === null) return { v3Compat: [], warnings: [] };
  const missing = missingTypesetUtilities(appRoot, classes, ignore);
  return {
    v3Compat: major === 3 ? v3ClassIssues(classes) : [],
    warnings: missing.length > 0 ? [typesetWarning(missing, major)] : [],
  };
}
