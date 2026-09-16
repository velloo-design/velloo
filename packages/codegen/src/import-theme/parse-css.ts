import type { ColorPair, Colors } from "@velloo/schema";
import { COLOR_SLOTS, SEMANTIC_SLOTS } from "../emit-theme/globals-css.ts";

/**
 * Parse theme tokens out of a host app's stylesheet — the reverse of
 * `emit-theme/globals-css.ts`. Understands both vocabularies in the wild:
 *
 * - **Stock shadcn**: `:root { --background: …; --primary: …; }` + `.dark { … }`,
 *   values as raw HSL triplets (`222.2 47.4% 11.2%`, the Tailwind v3-era
 *   convention) or full color functions (`oklch(1 0 0)`, v4-era).
 * - **Tailwind v4 / Velloo emit**: `@theme { --color-background: …; }` blocks,
 *   including the `@theme inline` indirection where `--color-*` vars point at
 *   `var(--background)`-style raw vars.
 *
 * Dark scopes come from `.dark { … }` selectors and from `:root` blocks nested
 * in `@media (prefers-color-scheme: dark)`. Pure text → tokens; no I/O.
 */
export interface ParsedThemeCss {
  colors: Partial<Colors>;
  colorsDark: Partial<Colors>;
  /**
   * Every non-semantic color var the app declares — numeric scales
   * (`primary-600`), extra roles (`success-500`, `danger`), and bare brand
   * names (`paprika`, `ink`) alike. Keyed by Tailwind color name; values
   * normalized to CSS colors. `paletteDark` carries `.dark` overrides. Always
   * present (possibly empty), mirroring `colors`.
   */
  palette: Record<string, string>;
  paletteDark: Record<string, string>;
  /** Resolved `--radius` value, if declared. */
  radius?: string;
  /** `--font-<role>` stacks (sans/mono/display/…), sizing roles excluded. */
  fontFamily?: Record<string, string>;
  warnings: string[];
  /**
   * The raw `:root`/`@theme` custom-property map (var name → declared value),
   * so callers that ingest tokens from *other* sources (a tailwind.config) can
   * resolve `var(--x)` references against the same stylesheet. Internal —
   * exposed for the importer, not part of the design-token surface.
   */
  rootVars: ReadonlyMap<string, string>;
}

const HSL_TRIPLET = /^-?[0-9.]+(?:deg)?\s+-?[0-9.]+%\s+-?[0-9.]+%(?:\s*\/\s*[0-9.]+%?)?$/;

/** Sizing/weight roles that share the `--font-` prefix but aren't families. */
const NON_FAMILY_FONT_ROLE = /^(size|weight|leading|tracking)(-|$)/;

/** A valid palette key — kebab-case identifier, matching the schema's PaletteSchema. */
const PALETTE_KEY = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

// Semantic slots (plus `-foreground` pairs) — kept out of palette. The set
// lives with the emit vocabulary in globals-css.ts so import and emit agree;
// re-exported here for existing consumers.
export { SEMANTIC_SLOTS };

/**
 * The Tailwind color name (sans `--`/`color-` prefix) a var should be captured
 * under as a raw palette entry, or null to skip. Captures any kebab-case color
 * var — numeric scales (`primary-600`), extra roles (`success`), and bare brand
 * names (`paprika`, `ink`) alike — EXCEPT the semantic slots (`--primary`,
 * `--background`, …), which extractColors owns. Non-color values (`--radius`,
 * `--font-*`) are dropped downstream by `isColorish`.
 *
 * Exported so token sources outside the stylesheet (a tailwind.config's
 * `theme.extend.colors`) apply the SAME semantic-slot exclusion before they
 * land in `palette` — otherwise a config `primary-foreground` would shadow the
 * semantic slot with an unrelated value. Pass the bare color name (no `--`).
 */
export function paletteName(rawKey: string): string | null {
  const name = rawKey.startsWith("color-") ? rawKey.slice(6) : rawKey;
  if (SEMANTIC_SLOTS.has(name)) return null;
  return PALETTE_KEY.test(name) ? name : null;
}

/**
 * Conservative color sniff: app scale vars are virtually always hex / rgb /
 * hsl / oklch / a raw HSL triplet. Bare named colors are rare for scales and
 * hard to enumerate, so we skip them — better to miss an obscure one than to
 * slurp a non-color var (`--shadow-500`) into the palette.
 */
function isColorish(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (HSL_TRIPLET.test(v)) return true;
  return (
    /^#[0-9a-f]{3,8}$/.test(v) ||
    /^(rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\(/.test(v) ||
    v === "transparent" ||
    v === "currentcolor"
  );
}

function stripComments(css: string): string {
  // A scan, not /\/\*[\s\S]*?\*\//g: that regex goes quadratic on an
  // unterminated comment followed by many `/*`.
  let out = "";
  let from = 0;
  for (;;) {
    const open = css.indexOf("/*", from);
    if (open === -1) return out + css.slice(from);
    const close = css.indexOf("*/", open + 2);
    if (close === -1) return out + css.slice(from);
    out += css.slice(from, open);
    from = close + 2;
  }
}

/**
 * For every `{` in `css`, the index of its matching `}` (or -1 when it never
 * closes), from one stack pass. Asking per brace instead rescans to the end of
 * the sheet each time, which a run of unclosed braces turns quadratic.
 */
function braceMatches(css: string): Map<number, number> {
  const matches = new Map<number, number>();
  const open: number[] = [];
  for (let i = 0; i < css.length; i++) {
    if (css[i] === "{") {
      open.push(i);
      matches.set(i, -1);
    } else if (css[i] === "}") {
      const at = open.pop();
      if (at !== undefined) matches.set(at, i);
    }
  }
  return matches;
}

const DECLARATION = /^--([a-zA-Z0-9-]+)\s*:([\s\S]*)$/;

/**
 * Scan `css` for blocks whose selector matches `selector` (a predicate over
 * the prelude text) and fold their custom-property declarations into `into`.
 * Later declarations win, mirroring the cascade.
 *
 * One pass: the text between consecutive `{`, `}` and `;` is either a block's
 * prelude or a declaration of the innermost open block. Matching each block's
 * body with a regex instead re-reads nested bodies once per enclosing block and
 * backtracks across a body with no `:` in it.
 */
function scanBlocks(
  css: string,
  matches: (prelude: string) => boolean,
  into: Map<string, string>,
): void {
  const collecting: boolean[] = [];
  let segmentStart = 0;
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === "{") {
      collecting.push(i > segmentStart && matches(css.slice(segmentStart, i).trim()));
    } else if (ch === ";") {
      if (collecting[collecting.length - 1]) {
        const declaration = DECLARATION.exec(css.slice(segmentStart, i).trim());
        const value = declaration?.[2]?.trim();
        if (declaration && value) into.set(declaration[1] as string, value);
      }
    } else if (ch === "}") {
      collecting.pop();
    } else {
      continue;
    }
    segmentStart = i + 1;
  }
}

const DARK_SCHEME = /prefers-color-scheme\s*:\s*dark/;

/**
 * Pull `@media (prefers-color-scheme: dark)` bodies out of the sheet: their
 * `:root` declarations belong to the dark scope, and leaving the segments in
 * place would mis-file them as light. Returns the css with those segments
 * blanked plus the extracted dark declarations.
 */
function splitDarkMedia(css: string): { css: string; darkVars: Map<string, string> } {
  const darkVars = new Map<string, string>();
  const closing = braceMatches(css);
  let out = css;
  let from = 0;
  for (;;) {
    const at = css.indexOf("@media", from);
    if (at === -1) break;
    // The prelude ends at the first brace; a `}` first means no block here.
    let start = at;
    while (start < css.length && css[start] !== "{" && css[start] !== "}") start++;
    // Resume past the scanned prelude either way: any later `@media` inside it
    // shares the same brace and a shorter prelude, so it can't match either.
    from = start + 1;
    if (css[start] !== "{" || !DARK_SCHEME.test(css.slice(at, start))) continue;
    const end = closing.get(start) ?? -1;
    if (end > start) {
      const body = css.slice(start + 1, end);
      scanBlocks(body, (p) => p.startsWith(":root") || p === "*", darkVars);
      out = out.slice(0, at) + " ".repeat(end + 1 - at) + out.slice(end + 1);
      // The body is handled; a dark query nested inside it must not be re-read.
      from = end + 1;
    }
  }
  return { css: out, darkVars };
}

/** Resolve `var(--x)` / `var(--x, fallback)` against the scope chain. */
function resolveVars(value: string, scopes: Array<Map<string, string>>, depth = 0): string | null {
  if (!value.includes("var(")) return value;
  if (depth > 4) return null;
  let unresolved = false;
  const replaced = value.replace(
    /var\(\s*--([a-zA-Z0-9-]+)\s*(?:,([^()]*))?\)/g,
    (_, name: string, fallback: string | undefined) => {
      for (const scope of scopes) {
        const v = scope.get(name);
        if (v !== undefined) return v;
      }
      if (fallback !== undefined) return fallback.trim();
      unresolved = true;
      return "";
    },
  );
  if (unresolved) return null;
  return resolveVars(replaced.trim(), scopes, depth + 1);
}

/**
 * Resolve every `var(--x)` / `var(--x, fallback)` in `value` against a single
 * stylesheet var map, returning the concrete value — or null if a referenced
 * var is undefined and has no fallback. For ingesting tailwind.config tokens
 * (e.g. `hsl(var(--primary-foreground))`) whose vars live in the imported
 * stylesheet, so they don't persist as dangling refs the canvas can't paint.
 */
export function resolveCssVars(value: string, vars: ReadonlyMap<string, string>): string | null {
  return resolveVars(value, [vars as Map<string, string>]);
}

/** Wrap raw HSL triplets (`222.2 47.4% 11.2%`) into a usable `hsl(…)`. */
function normalizeColor(value: string): string {
  const v = value.trim();
  return HSL_TRIPLET.test(v) ? `hsl(${v})` : v;
}

/** Slot lookup in the scope that *declares* it: `--color-<slot>` wins over `--<slot>`. */
function lookupSlot(slot: string, declScope: Map<string, string>): string | undefined {
  return declScope.get(`color-${slot}`) ?? declScope.get(slot);
}

/**
 * Extract color slots declared in `declScope`, resolving `var()` refs against
 * `resolveScopes` (dark-first then root, matching the cascade). Slots the
 * scope doesn't declare are omitted — colorsDark stays overrides-only.
 */
function extractColors(
  declScope: Map<string, string>,
  resolveScopes: Array<Map<string, string>>,
  scopeName: string,
  warnings: string[],
): Partial<Colors> {
  const colors: Record<string, ColorPair> = {};
  for (const { key, pair } of COLOR_SLOTS) {
    const raw = lookupSlot(key, declScope);
    if (raw === undefined) continue;
    const resolved = resolveVars(raw, resolveScopes);
    if (resolved === null || resolved === "") {
      warnings.push(`${scopeName}: --${key} references an undefined var — skipped`);
      continue;
    }
    const value = normalizeColor(resolved);
    if (!pair) {
      colors[key] = value;
      continue;
    }
    const fgRaw = lookupSlot(`${key}-foreground`, declScope);
    const fg = fgRaw !== undefined ? resolveVars(fgRaw, resolveScopes) : null;
    colors[key] =
      fg !== null && fg !== "" && fgRaw !== undefined
        ? { DEFAULT: value, foreground: normalizeColor(fg) }
        : value;
  }
  return colors as Partial<Colors>;
}

/**
 * Pull numeric scales + extra roles out of `declScope`, resolving `var()` refs
 * against `resolveScopes`. Only color-valued vars survive (see `isColorish`).
 */
function extractPalette(
  declScope: Map<string, string>,
  resolveScopes: Array<Map<string, string>>,
): Record<string, string> {
  const palette: Record<string, string> = {};
  for (const [rawKey, raw] of declScope) {
    const name = paletteName(rawKey);
    if (name === null) continue;
    // `--color-primary-600` wins over `--primary-600` when both are declared.
    if (rawKey.startsWith("color-") || !declScope.has(`color-${rawKey}`)) {
      const resolved = resolveVars(raw, resolveScopes);
      if (resolved === null || resolved === "" || !isColorish(resolved)) continue;
      palette[name] = normalizeColor(resolved);
    }
  }
  return palette;
}

export function parseThemeCss(css: string): ParsedThemeCss {
  const warnings: string[] = [];
  const stripped = stripComments(css);
  const { css: lightCss, darkVars: mediaDarkVars } = splitDarkMedia(stripped);

  const rootVars = new Map<string, string>();
  scanBlocks(
    lightCss,
    (p) => p.startsWith(":root") || p.startsWith("@theme") || p.startsWith("html"),
    rootVars,
  );

  const darkVars = mediaDarkVars;
  scanBlocks(lightCss, (p) => /(^|[\s,])\.dark(\s|,|:|$)/.test(p) || p === ".dark", darkVars);

  const colors = extractColors(rootVars, [rootVars], "light", warnings);
  const colorsDark =
    darkVars.size > 0 ? extractColors(darkVars, [darkVars, rootVars], "dark", warnings) : {};

  const palette = extractPalette(rootVars, [rootVars]);
  const paletteDark = darkVars.size > 0 ? extractPalette(darkVars, [darkVars, rootVars]) : {};

  const result: ParsedThemeCss = {
    colors,
    colorsDark,
    palette,
    paletteDark,
    warnings,
    rootVars,
  };

  const radiusRaw = rootVars.get("radius");
  if (radiusRaw !== undefined) {
    const radius = resolveVars(radiusRaw, [rootVars]);
    if (radius !== null && radius !== "") result.radius = radius;
    else warnings.push("--radius references an undefined var — skipped");
  }

  const fontFamily: Record<string, string> = {};
  for (const [name, value] of rootVars) {
    const m = /^font-([a-z][a-z0-9-]*)$/.exec(name);
    if (!m) continue;
    const role = m[1] as string;
    if (NON_FAMILY_FONT_ROLE.test(role)) continue;
    const resolved = resolveVars(value, [rootVars]);
    if (resolved !== null && resolved !== "") fontFamily[role] = resolved;
  }
  if (Object.keys(fontFamily).length > 0) result.fontFamily = fontFamily;

  return result;
}
