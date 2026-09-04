import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Colors, Theme } from "@velloo/schema";
import type { ImportedTheme } from "./import-theme.ts";
import { buildPresetTheme } from "./theme-presets.ts";

/**
 * A hand-rolled scanner replaces ts-morph here: this is the CLI's only AST use,
 * and ts-morph bundles a full TypeScript compiler (~15MB) into every user
 * install for a feature that is explicitly best-effort. Only inline literals
 * are understood — anything else (spreads, calls, identifiers, arrays,
 * template substitutions) parses to `undefined`, exactly like the old
 * `asKind(...)` misses. Never executes user code.
 */

/** A parsed inline literal: string, number, or a nested object of them. */
type LiteralValue = string | number | LiteralObject;
type LiteralObject = Map<string, LiteralValue>;

const IDENT_CHAR = /[A-Za-z0-9_$]/;

function skipWs(code: string, i: number): number {
  while (i < code.length && /\s/.test(code.charAt(i))) i++;
  return i;
}

/** Index just past the closing quote of the string/template opening at `i` (raw skip, no value). */
function scanString(code: string, i: number): number {
  const quote = code.charAt(i);
  i++;
  while (i < code.length) {
    const ch = code.charAt(i);
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === quote) return i + 1;
    if (quote === "`" && ch === "$" && code.charAt(i + 1) === "{") {
      i = scanBalanced(code, i + 1);
      continue;
    }
    if (quote !== "`" && ch === "\n") return i; // unterminated — bail at the line break
    i++;
  }
  return i;
}

/** Index just past the `{`/`(`/`[` group opening at `i`, skipping nested strings. */
function scanBalanced(code: string, i: number): number {
  const open = code.charAt(i);
  const close = open === "{" ? "}" : open === "(" ? ")" : "]";
  let depth = 0;
  while (i < code.length) {
    const ch = code.charAt(i);
    if (ch === '"' || ch === "'" || ch === "`") {
      i = scanString(code, i);
      continue;
    }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return i + 1;
    }
    i++;
  }
  return i;
}

/**
 * Strip line and block comments, leaving string/template contents intact.
 * Regex literals are not modeled (a `/` starting one is read as division) —
 * acceptable for theme modules, and failure just means a null import.
 */
function stripComments(src: string): string {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const ch = src.charAt(i);
    if (ch === "/" && src.charAt(i + 1) === "/") {
      while (i < src.length && src.charAt(i) !== "\n") i++;
      continue;
    }
    if (ch === "/" && src.charAt(i + 1) === "*") {
      i += 2;
      while (i < src.length && !(src.charAt(i) === "*" && src.charAt(i + 1) === "/")) i++;
      i += 2;
      out += " ";
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      const end = scanString(src, i);
      out += src.slice(i, end);
      i = end;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

const ESCAPES: Record<string, string> = {
  n: "\n",
  t: "\t",
  r: "\r",
  b: "\b",
  f: "\f",
  v: "\v",
  "0": "\0",
};

/**
 * The cooked value of the string/template literal opening at `i`. Undefined
 * for unterminated strings and templates with `${…}` substitutions (a
 * substitution makes it a non-literal). `\u`/`\x` sequences degrade to their
 * raw letters — colors and font stacks never use them.
 */
function parseStringLiteral(code: string, i: number): { value: string; end: number } | undefined {
  const quote = code.charAt(i);
  let out = "";
  let j = i + 1;
  while (j < code.length) {
    const ch = code.charAt(j);
    if (ch === "\\") {
      const next = code.charAt(j + 1);
      out += ESCAPES[next] ?? next;
      j += 2;
      continue;
    }
    if (ch === quote) return { value: out, end: j + 1 };
    if (quote === "`" && ch === "$" && code.charAt(j + 1) === "{") return undefined;
    if (quote !== "`" && ch === "\n") return undefined;
    out += ch;
    j++;
  }
  return undefined;
}

function parseNumber(code: string, i: number): { value: number; end: number } | undefined {
  const m = /^(?:\d[\d_]*(?:\.[\d_]*)?|\.\d[\d_]*)(?:[eE][+-]?\d+)?/.exec(code.slice(i));
  if (!m) return undefined;
  const value = Number(m[0].replace(/_/g, ""));
  if (Number.isNaN(value)) return undefined;
  return { value, end: i + m[0].length };
}

function parseValue(code: string, i: number): { value: LiteralValue; end: number } | undefined {
  const ch = code.charAt(i);
  if (ch === '"' || ch === "'" || ch === "`") return parseStringLiteral(code, i);
  if (ch === "{") return parseObjectLiteral(code, i);
  if (/[\d.]/.test(ch)) return parseNumber(code, i);
  return undefined;
}

/** Index of the `,` or `}` ending the current object entry (not consumed). */
function skipEntry(code: string, i: number): number {
  while (i < code.length) {
    const ch = code.charAt(i);
    if (ch === "," || ch === "}") return i;
    if (ch === '"' || ch === "'" || ch === "`") {
      i = scanString(code, i);
      continue;
    }
    if (ch === "{" || ch === "(" || ch === "[") {
      i = scanBalanced(code, i);
      continue;
    }
    i++;
  }
  return i;
}

/**
 * Parse the object literal opening at `i`. Entries whose key is an identifier
 * or string and whose value is an inline literal are kept; everything else
 * (spreads, shorthands, methods, computed keys, non-literal values, `as`/
 * `satisfies` on a value) is skipped entry-by-entry. Undefined only when the
 * braces never close.
 */
function parseObjectLiteral(
  code: string,
  i: number,
): { value: LiteralObject; end: number } | undefined {
  const obj: LiteralObject = new Map();
  i++;
  for (;;) {
    i = skipWs(code, i);
    if (i >= code.length) return undefined;
    const ch = code.charAt(i);
    if (ch === "}") return { value: obj, end: i + 1 };
    if (ch === ",") {
      i++;
      continue;
    }

    let key: string | undefined;
    if (ch === '"' || ch === "'") {
      const parsed = parseStringLiteral(code, i);
      if (parsed) {
        key = parsed.value;
        i = parsed.end;
      }
    } else {
      const m = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(code.slice(i));
      if (m) {
        key = m[0];
        i += m[0].length;
      }
    }
    i = skipWs(code, i);
    if (key === undefined || code.charAt(i) !== ":") {
      i = skipEntry(code, i);
      continue;
    }

    const parsed = parseValue(code, skipWs(code, i + 1));
    if (parsed) {
      const after = skipWs(code, parsed.end);
      // Only keep values that end the entry cleanly — `10 as const` is a
      // non-literal expression, matching the old asKind(NumericLiteral) miss.
      const term = code.charAt(after);
      if (term === "," || term === "}") {
        obj.set(key, parsed.value);
        i = after;
        continue;
      }
    }
    i = skipEntry(code, i);
  }
}

/** Index of the `(` of the first `createTheme(…)` / `xxx.createTheme(…)` call, skipping strings. */
function findCreateThemeCall(code: string): number | undefined {
  let i = 0;
  while (i < code.length) {
    const ch = code.charAt(i);
    if (ch === '"' || ch === "'" || ch === "`") {
      i = scanString(code, i);
      continue;
    }
    if (ch === "c" && code.startsWith("createTheme", i)) {
      const before = code.charAt(i - 1);
      const after = code.charAt(i + "createTheme".length);
      if ((i === 0 || !IDENT_CHAR.test(before)) && !IDENT_CHAR.test(after)) {
        const paren = skipWs(code, i + "createTheme".length);
        if (code.charAt(paren) === "(") return paren;
      }
    }
    i++;
  }
  return undefined;
}

/** Find the `createTheme(...)` call's first argument object literal, if any. */
function createThemeArg(src: string): LiteralObject | undefined {
  const code = stripComments(src);
  const paren = findCreateThemeCall(code);
  if (paren === undefined) return undefined;
  const arg = skipWs(code, paren + 1);
  if (code.charAt(arg) !== "{") return undefined;
  return parseObjectLiteral(code, arg)?.value;
}

/** The value of `name` on an object literal, or undefined. */
function prop(obj: LiteralObject, name: string): LiteralValue | undefined {
  return obj.get(name);
}

function asObject(value: LiteralValue | undefined): LiteralObject | undefined {
  return value instanceof Map ? value : undefined;
}

/** A string literal value (`"#1976d2"`, `'Inter'`), unquoted. */
function asString(value: LiteralValue | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: LiteralValue | undefined): number | undefined {
  return typeof value === "number" ? value : undefined;
}

/**
 * Read a MUI theme module — a `createTheme({ palette, shape, typography })`
 * call — and project its `ThemeOptions` back onto velloo's token tree (the
 * inverse of provider-mui's `muiThemeOptions`). Best-effort + side-effect-free:
 * only inline string/number literals are read, and an unparseable or
 * non-literal theme returns null so the caller falls back to the preset.
 *
 * The "existing project" flow's theme import for MUI apps, the counterpart to
 * `importThemeFromGlobals`.
 */
export function importThemeFromMui(filePath: string, presetId?: string): ImportedTheme | null {
  let src: string;
  try {
    src = readFileSync(filePath, "utf8");
  } catch {
    return null;
  }

  const root = createThemeArg(src);
  if (!root) return null;
  const palette = asObject(prop(root, "palette"));

  const colors: Partial<Colors> = {};
  const warnings: string[] = [];
  let tokenCount = 0;

  if (palette) {
    const pairOf = (
      key: string,
    ): { main?: string | undefined; contrastText?: string | undefined } => {
      const o = asObject(prop(palette, key));
      return {
        main: o && asString(prop(o, "main")),
        contrastText: o && asString(prop(o, "contrastText")),
      };
    };
    const text = asObject(prop(palette, "text"));
    const textPrimary = text && asString(prop(text, "primary"));

    const primary = pairOf("primary");
    if (primary.main) {
      colors.primary = { DEFAULT: primary.main, foreground: primary.contrastText ?? "#ffffff" };
      tokenCount++;
    }
    const secondary = pairOf("secondary");
    if (secondary.main) {
      colors.secondary = {
        DEFAULT: secondary.main,
        foreground: secondary.contrastText ?? "#ffffff",
      };
      tokenCount++;
    }
    const error = pairOf("error");
    if (error.main) {
      colors.destructive = { DEFAULT: error.main, foreground: error.contrastText ?? "#ffffff" };
      tokenCount++;
    }
    const background = asObject(prop(palette, "background"));
    const bgDefault = background && asString(prop(background, "default"));
    const bgPaper = background && asString(prop(background, "paper"));
    if (bgDefault) {
      colors.background = bgDefault;
      tokenCount++;
    }
    // velloo's `card` is a surface pair; MUI's paper has no on-color, so use the
    // primary text color (text on a paper surface) for its foreground.
    if (bgPaper) {
      colors.card = { DEFAULT: bgPaper, foreground: textPrimary ?? "#111827" };
      tokenCount++;
    }
    if (textPrimary) {
      colors.foreground = textPrimary;
      tokenCount++;
    }
    const divider = asString(prop(palette, "divider"));
    if (divider) {
      colors.border = divider;
      tokenCount++;
    }
    // `text.secondary` maps to muted-foreground, but velloo's `muted` also needs
    // a surface color MUI doesn't define — left to the base preset rather than
    // inventing one.
  }

  const shape = asObject(prop(root, "shape"));
  const borderRadius = shape && asNumber(prop(shape, "borderRadius"));
  const typography = asObject(prop(root, "typography"));
  const fontFamily = typography && asString(prop(typography, "fontFamily"));

  if (tokenCount === 0 && borderRadius === undefined && fontFamily === undefined) {
    return null;
  }

  const base = buildPresetTheme(presetId, "default");
  const theme: Theme = {
    ...base,
    colors: { ...base.colors, ...colors },
    radius: borderRadius !== undefined ? { ...base.radius, md: borderRadius } : base.radius,
    typography: fontFamily
      ? { ...base.typography, fontFamily: { ...base.typography.fontFamily, sans: fontFamily } }
      : base.typography,
  };

  return { theme, importedFrom: filePath, tokenCount, warnings };
}

/**
 * Best-effort location of a MUI theme module under the app root (no canonical
 * path). Checks the common spots; returns undefined if none contains a
 * `createTheme(` call. Side-effect-free.
 */
export function findMuiTheme(appRoot: string): string | undefined {
  const candidates = [
    "src/theme.ts",
    "src/theme.tsx",
    "src/theme/index.ts",
    "src/theme/index.tsx",
    "theme.ts",
    "src/styles/theme.ts",
    "src/lib/theme.ts",
    "app/theme.ts",
    "src/app/theme.ts",
  ];
  for (const rel of candidates) {
    const abs = join(appRoot, rel);
    if (!existsSync(abs)) continue;
    try {
      if (readFileSync(abs, "utf8").includes("createTheme(")) return abs;
    } catch {
      // unreadable — keep looking
    }
  }
  return undefined;
}
