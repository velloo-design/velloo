import { markdownSections, paletteName } from "@velloo/codegen";
import { err, ok, type Result } from "@velloo/result";
import { type ColorPair, ColorsSchema, type Theme, ThemeSchema } from "@velloo/schema";
import { catalogFont, fontStack } from "@velloo/schema/fonts";
import { type DesignFolder, themeByName } from "../design-folder.ts";
import { persistNamedTheme } from "../mutations/persist.ts";
import { contrastRatio } from "./contrast.ts";
import { invalidThemePath, type ThemeError, themeBadRequest } from "./errors.ts";

/**
 * Import a Google Labs `DESIGN.md` (https://github.com/google-labs-code/design.md)
 * into a velloo theme.
 *
 * The spec is at version `alpha`, so nothing here touches `@velloo/schema` —
 * this is an edge format like the Tailwind v3 projection, parsed on the way in
 * and never persisted in its own shape.
 */

/**
 * Candidate DESIGN.md token names for each velloo color slot, best first. The
 * first name a file actually declares wins the slot; velloo's own name heads
 * every list, so a DESIGN.md written against shadcn naming is never re-routed.
 *
 * This table is the difference between a working import and a no-op, because
 * the spec prescribes no color vocabulary at all. A survey of the DESIGN.md
 * files on GitHub (2026-09) found three that recur:
 *
 *   - Material 3 (`surface`, `on-surface`, `outline`, `error`) — what all
 *     three examples Google ships use.
 *   - Bootstrap-ish semantic (`danger`, `success`, `light`, `dark`).
 *   - Editorial (`canvas`, `ink`, `hairline`, `surface-card`) — what the
 *     hand-written brand systems use.
 *
 * Matching on velloo's names alone mapped 2 of 12 slots on the editorial files
 * and 2 of 12 on the Material ones, in both cases parking everything in
 * `palette.*`, which themes nothing: the import reports success and the canvas
 * does not move. One token may legitimately feed several slots (`on-surface`
 * is both the page foreground and a card's), so slots are resolved
 * independently rather than consuming names.
 */
const SLOT_CANDIDATES: ReadonlyArray<readonly [slotPath: string, names: readonly string[]]> = [
  ["background", ["background", "surface", "canvas", "canvas-light", "page", "bg"]],
  ["foreground", ["foreground", "on-background", "on-surface", "ink", "text", "body", "on-canvas"]],
  ["primary.DEFAULT", ["primary", "brand"]],
  ["primary.foreground", ["primary-foreground", "on-primary"]],
  ["secondary.DEFAULT", ["secondary"]],
  ["secondary.foreground", ["secondary-foreground", "on-secondary"]],
  ["muted.DEFAULT", ["muted", "surface-variant", "mute", "subtle"]],
  [
    "muted.foreground",
    ["muted-foreground", "on-surface-variant", "body", "ink-muted", "body-muted", "text-muted"],
  ],
  ["accent.DEFAULT", ["accent", "tertiary"]],
  ["accent.foreground", ["accent-foreground", "on-tertiary", "on-accent"]],
  [
    "destructive.DEFAULT",
    ["destructive", "error", "danger", "semantic-error", "semantic-danger", "negative"],
  ],
  ["destructive.foreground", ["destructive-foreground", "on-error", "on-danger", "on-destructive"]],
  [
    "card.DEFAULT",
    [
      "card",
      "surface-container",
      "surface-card",
      "surface-soft",
      "surface-1",
      "surface-elevated",
      "surface-container-low",
      "surface-container-lowest",
    ],
  ],
  ["card.foreground", ["card-foreground", "on-surface", "ink"]],
  [
    "popover.DEFAULT",
    [
      "popover",
      "surface-container-high",
      "surface-strong",
      "surface-2",
      "surface-container-highest",
    ],
  ],
  ["popover.foreground", ["popover-foreground", "on-surface", "ink"]],
  ["border", ["border", "outline", "hairline", "divider", "stroke", "rule"]],
  [
    "input",
    [
      "input",
      "outline-variant",
      "hairline-soft",
      "divider-soft",
      "hairline-strong",
      "border-strong",
    ],
  ],
  ["ring", ["ring", "focus", "focus-ring", "primary-focus", "primary"]],
];
interface ThemeTokenChange {
  token: string;
  from: string | null;
  to: string;
}

/** A DESIGN.md section velloo's theme has no home for. */
interface DroppedSection {
  section: string;
  count: number;
  reason: string;
}

interface ImportDesignMdCoverage {
  /** Semantic color slots reached, of `semanticTotal`. */
  semantic: number;
  semanticTotal: number;
  /** Raw color tokens parked in `palette.*` — real, but they do not theme-flip. */
  palette: number;
  /** Semantic slots left on their previous values. */
  unmapped: string[];
  /** Slots filled through a non-velloo name (see {@link SLOT_CANDIDATES}). */
  aliased: { from: string; to: string }[];
}

export interface ImportDesignMdResult {
  theme: Theme;
  /** The design system's `name:`, for the agent to echo. */
  designSystem: string;
  changes: ThemeTokenChange[];
  coverage: ImportDesignMdCoverage;
  dropped: DroppedSection[];
  /**
   * The markdown body — the half of the spec that carries design intent.
   * Never copied into the folder: the folder records the file's path and
   * reads it live, so the design agents follow the file the repo actually
   * has rather than a snapshot of what it said at import time.
   */
  prose: { sections: string[]; bytes: number };
  warnings: string[];
  applied: boolean;
  mode: "light" | "dark";
}

interface Frontmatter {
  name?: unknown;
  version?: unknown;
  description?: unknown;
  omitted?: unknown;
  colors?: unknown;
  typography?: unknown;
  rounded?: unknown;
  spacing?: unknown;
  components?: unknown;
}

/** `---\n<yaml>\n---\n<body>`. Returns null when the file has no frontmatter. */
function splitFrontmatter(src: string): { yaml: string; body: string } | null {
  const text = src.replace(/^﻿/, "");
  if (!/^---[ \t]*\r?\n/.test(text)) return null;
  const rest = text.slice(text.indexOf("\n") + 1);
  const close = /^---[ \t]*$/m.exec(rest);
  if (close === null || close.index === undefined) return null;
  return { yaml: rest.slice(0, close.index), body: rest.slice(close.index + close[0].length) };
}

const REF = /^\{([A-Za-z0-9_.-]+)\}$/;

/** Read `a.b.c` out of a parsed tree. */
function at(root: unknown, path: string): unknown {
  let cursor = root;
  for (const seg of path.split(".")) {
    if (typeof cursor !== "object" || cursor === null) return undefined;
    cursor = (cursor as Record<string, unknown>)[seg];
  }
  return cursor;
}

/**
 * Resolve `{colors.primary-60}` references in place. Chains resolve up to
 * `MAX_HOPS`; a cycle or a dangling ref leaves the literal text, which the
 * per-section mapping then rejects as a non-color / non-dimension.
 */
const MAX_HOPS = 8;
function resolveRefs(root: unknown, value: unknown, hops = 0): unknown {
  if (typeof value === "string") {
    const m = REF.exec(value.trim());
    if (!m?.[1] || hops >= MAX_HOPS) return value;
    const target = at(root, m[1]);
    return target === undefined ? value : resolveRefs(root, target, hops + 1);
  }
  if (Array.isArray(value)) return value.map((v) => resolveRefs(root, v, hops));
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = resolveRefs(root, v, hops);
    return out;
  }
  return value;
}

function asStringMap(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === "string" && v.trim() !== "") out[k] = v.trim();
    else if (typeof v === "number") out[k] = String(v);
  }
  return out;
}

/** Velloo radius levels. A DESIGN.md `<scale-level>` outside this set has no home. */
const RADIUS_LEVELS = new Set(["none", "sm", "md", "lg", "xl", "2xl", "3xl", "full"]);

/**
 * Which velloo font role a DESIGN.md typography token belongs to.
 *
 * The family name is checked before the token name because a monospace face is
 * routinely assigned to tokens called `label`, `figure` or `caption` — naming
 * the job, not the typeface. Classifying those as body copy silently drops the
 * mono face entirely and hands its role to whatever body token came first.
 */
function roleOf(token: string, family?: string): "heading" | "mono" | "body" {
  if (family !== undefined && /\bmono\b|consolas|courier|menlo|monaco|\bcode\b/i.test(family)) {
    return "mono";
  }
  const t = token.toLowerCase();
  if (/mono|code/.test(t)) return "mono";
  if (/^(display|headline|title|heading|h[1-6])\b|^(display|headline|title|heading)-/.test(t)) {
    return "heading";
  }
  return "body";
}

/** `44px` / `1.5rem` → number of px-ish units, for deriving a unitless leading. */
function dimValue(raw: unknown): number | null {
  if (typeof raw === "number") return raw;
  if (typeof raw !== "string") return null;
  const m = /^(-?[\d.]+)(px|rem|em)?$/.exec(raw.trim());
  if (!m?.[1]) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  return m[2] === "rem" || m[2] === "em" ? n * 16 : n;
}

/** White-on-dark reads better than black-on-dark. */
function looksDark(background: string): boolean {
  const onWhite = contrastRatio("#ffffff", background);
  const onBlack = contrastRatio("#000000", background);
  if (onWhite === null || onBlack === null) return false;
  return onWhite > onBlack;
}

export interface ImportDesignMdOptions {
  themeName?: string | undefined;
  apply?: boolean | undefined;
  /**
   * Which color set the file's palette lands in. DESIGN.md has no concept of
   * light and dark — one file is one palette — so a folder that wants both
   * imports two files, the second with `mode: "dark"` into `colorsDark`.
   */
  mode?: "light" | "dark" | undefined;
  /**
   * Where the file came from, when it came from disk. Recorded in the config
   * so the folder keeps following it; omitted for text pasted inline, which
   * has no file to follow.
   */
  sourcePath?: string | undefined;
}

/** Records one token write for the change report; a no-op write is not a change. */
type RecordChange = (token: string, to: string) => void;

/** The frontmatter token groups, normalized to what the mappers read. */
interface DesignMdTokens {
  colors: Record<string, string>;
  rounded: Record<string, string>;
  spacing: Record<string, string>;
  typography: Record<string, unknown>;
  componentCount: number;
}

function tokensOf(fm: Frontmatter): DesignMdTokens {
  return {
    colors: asStringMap(fm.colors),
    rounded: asStringMap(fm.rounded),
    spacing: asStringMap(fm.spacing),
    typography:
      typeof fm.typography === "object" && fm.typography !== null && !Array.isArray(fm.typography)
        ? (fm.typography as Record<string, unknown>)
        : {},
    componentCount:
      typeof fm.components === "object" && fm.components !== null
        ? Object.keys(fm.components).length
        : 0,
  };
}

/** Frontmatter parsed, references resolved, `name:` present — or why not. */
function parseDesignMd(source: string): Result<{ fm: Frontmatter; body: string }, ThemeError> {
  const split = splitFrontmatter(source);
  if (!split) {
    return err(
      themeBadRequest(
        "no YAML frontmatter — a DESIGN.md opens with `---`, a token block, and a closing `---`. See https://github.com/google-labs-code/design.md",
      ),
    );
  }
  let parsed: unknown;
  try {
    parsed = Bun.YAML.parse(split.yaml);
  } catch (e) {
    return err(themeBadRequest(`DESIGN.md frontmatter is not valid YAML: ${(e as Error).message}`));
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return err(themeBadRequest("DESIGN.md frontmatter must be a YAML mapping"));
  }
  const fm = resolveRefs(parsed, parsed) as Frontmatter;
  if (typeof fm.name !== "string" || fm.name.trim() === "") {
    return err(themeBadRequest("DESIGN.md frontmatter is missing the required `name:` field"));
  }
  return ok({ fm, body: split.body });
}

interface ColorMapping {
  semanticSlots: Set<string>;
  aliased: { from: string; to: string }[];
  paletteNames: Set<string>;
  paletteKey: "palette" | "paletteDark";
}

/** Colors onto the semantic slots via {@link SLOT_CANDIDATES}, and all of them into the palette. */
function mapColors(
  next: Theme,
  colors: Record<string, string>,
  mode: "light" | "dark",
  record: RecordChange,
): ColorMapping {
  const prefix = mode === "dark" ? "colorsDark" : "colors";
  if (mode === "dark") next.colorsDark = { ...(next.colorsDark ?? {}) };
  const out = (mode === "dark" ? next.colorsDark : next.colors) as unknown as Record<
    string,
    ColorPair
  >;

  const semanticSlots = new Set<string>();
  const aliased: { from: string; to: string }[] = [];

  /** Write one slot path (`border` / `primary.DEFAULT`). */
  const claim = (slotPath: string, value: string): void => {
    const [slot, part] = slotPath.split(".");
    if (slot === undefined) return;
    semanticSlots.add(slot);
    if (part === undefined) {
      out[slot] = value;
      record(`${prefix}.${slot}`, value);
      return;
    }
    const existing = out[slot];
    const pair =
      typeof existing === "object" && existing !== null
        ? { ...existing }
        : { DEFAULT: typeof existing === "string" ? existing : value };
    if (part === "foreground") pair.foreground = value;
    else pair.DEFAULT = value;
    out[slot] = pair;
    record(`${prefix}.${slot}.${part}`, value);
  };

  for (const [slotPath, names] of SLOT_CANDIDATES) {
    const matched = names.find((n) => colors[n] !== undefined);
    if (matched === undefined) continue;
    claim(slotPath, colors[matched] as string);
    // names[0] is velloo's own spelling; anything else is a vocabulary the
    // agent should be told about, because it is a judgement call.
    if (matched !== names[0]) aliased.push({ from: matched, to: `${prefix}.${slotPath}` });
  }

  // Everything the file named also lands in `palette.*`, so a class written
  // against the design system's own vocabulary (`bg-surface-container`)
  // resolves on the canvas instead of silently falling back.
  const paletteKey = mode === "dark" ? "paletteDark" : "palette";
  const paletteNames = new Set<string>();
  const palette: Record<string, string> = { ...(next[paletteKey] ?? {}) };
  for (const [key, value] of Object.entries(colors)) {
    const name = paletteName(key);
    if (name === null) continue;
    paletteNames.add(name);
    palette[name] = value;
    record(`${paletteKey}.${name}`, value);
  }
  if (paletteNames.size > 0) next[paletteKey] = palette;

  return { semanticSlots, aliased, paletteNames, paletteKey };
}

/** `rounded` onto velloo's radius levels, keeping `radius.md` (`--radius`) honest. */
function mapRadius(
  next: Theme,
  rounded: Record<string, string>,
  record: RecordChange,
  warnings: string[],
): void {
  if (Object.keys(rounded).length === 0) return;
  const radius = { ...next.radius } as Record<string, string | number>;
  const droppedRadius: string[] = [];
  let supersededDefault: string | undefined;
  for (const [level, value] of Object.entries(rounded)) {
    if (RADIUS_LEVELS.has(level)) {
      radius[level] = value;
      record(`radius.${level}`, value);
      continue;
    }
    if (level === "DEFAULT") {
      // The spec's unnamed base step. It becomes velloo's `radius.md` — the
      // slot emit_theme writes as `--radius` — unless the file also named
      // `md`, which is then the truer value for that slot.
      if (rounded.md === undefined) {
        radius.md = value;
        record("radius.md", value);
      } else {
        supersededDefault = value;
      }
      continue;
    }
    droppedRadius.push(level);
  }
  next.radius = radius as Theme["radius"];

  if (droppedRadius.length > 0) {
    warnings.push(
      `rounded levels ${droppedRadius.map((l) => `"${l}"`).join(", ")} have no velloo radius slot (velloo has ${[...RADIUS_LEVELS].join(", ")}) — dropped.`,
    );
  }
  // `md` is the slot emit_theme writes as `--radius`, so a file that declares a
  // radius scale without naming it leaves the anchor on whatever the preset
  // shipped — a system stating "nothing is rounded" still renders rounded.
  if (rounded.md === undefined && rounded.DEFAULT === undefined) {
    const declared = [...new Set(Object.values(rounded))];
    if (declared.length === 1) {
      // One value across the whole scale is a system with ONE radius. Setting
      // only the anchor is not enough: the preset's other steps survive and
      // contradict the file, so a document stating "nothing is rounded" still
      // renders `rounded-sm` at 4px. `full` is left alone — it is a shape
      // (pill, circle), not a step on the size scale.
      const only = declared[0] as string;
      for (const level of RADIUS_LEVELS) {
        if (level === "full") continue;
        radius[level] = only;
      }
      record("radius.md", only);
      warnings.push(
        `rounded declares a single radius (${only}) and no \`md\`/\`DEFAULT\` step — applied it to every size step, including radius.md, which is what \`--radius\` resolves to. \`radius.full\` is unchanged: it means pill/circle rather than a size. Set it too if this system squares avatars and chips.`,
      );
    } else {
      warnings.push(
        `rounded names ${Object.keys(rounded)
          .map((l) => `"${l}"`)
          .join(
            ", ",
          )} but not \`md\` or \`DEFAULT\`. velloo's \`radius.md\` is what \`--radius\` resolves to, so it is still on the previous value (${String(radius.md ?? "unset")}) — set it with set_theme if this system has one base radius.`,
      );
    }
  }
  if (supersededDefault !== undefined) {
    warnings.push(
      `rounded.DEFAULT (${supersededDefault}) was dropped: velloo has no unnamed base step, and this file also names \`md\` (${rounded.md}), which took the \`--radius\` slot. Set radius.md yourself if DEFAULT is the step your components actually use.`,
    );
  }
}

function mapSpacing(next: Theme, spacingIn: Record<string, string>, record: RecordChange): void {
  if (Object.keys(spacingIn).length === 0) return;
  const spacing = { ...next.spacing } as Record<string, string | number>;
  for (const [level, value] of Object.entries(spacingIn)) {
    spacing[level] = value;
    record(`spacing.${level}`, value);
  }
  next.spacing = spacing;
}

/**
 * Font families onto velloo's font roles and the body token onto the default
 * typeset. Returns the section as dropped, since the per-token ladder is not
 * something velloo stores.
 */
function mapTypography(
  next: Theme,
  typographyIn: Record<string, unknown>,
  record: RecordChange,
  warnings: string[],
): DroppedSection | null {
  if (Object.keys(typographyIn).length === 0) return null;
  const googleFonts = new Set(next.typography.googleFonts ?? []);
  const families: Record<"heading" | "body" | "mono", string | undefined> = {
    heading: undefined,
    body: undefined,
    mono: undefined,
  };
  let bodyToken: Record<string, unknown> | undefined;
  for (const [token, spec] of Object.entries(typographyIn)) {
    if (typeof spec !== "object" || spec === null) continue;
    const s = spec as Record<string, unknown>;
    const role = roleOf(token, typeof s.fontFamily === "string" ? s.fontFamily : undefined);
    if (typeof s.fontFamily === "string" && families[role] === undefined) {
      families[role] = s.fontFamily.trim();
    }
    if (role === "body" && (bodyToken === undefined || /^body/i.test(token))) bodyToken = s;
  }

  const fontFamily = { ...(next.typography.fontFamily ?? {}) };
  /** A bare family name becomes a real stack, and a catalogued one a webfont load. */
  const declare = (role: string, family: string): void => {
    const known = catalogFont(family);
    const stack = known ? fontStack(known) : `"${family}", ui-sans-serif, system-ui, sans-serif`;
    fontFamily[role] = stack;
    record(`typography.fontFamily.${role}`, stack);
    if (known)
      googleFonts.add(known.google === true ? known.family : `${known.family}:${known.google}`);
    else
      warnings.push(
        `font "${family}" is not in velloo's font catalog — declared as a stack but no webfont is loaded; add one with set_fonts if the canvas should render it.`,
      );
  };

  if (families.body) declare("sans", families.body);
  if (families.mono) declare("mono", families.mono);
  if (families.heading && families.heading !== families.body) declare("display", families.heading);

  const typeset = { ...(next.typography.typesets?.default ?? {}) };
  if (families.body) typeset.fontBody = "sans";
  if (families.mono) typeset.fontMono = "mono";
  if (families.heading) {
    typeset.fontHeading = families.heading === families.body ? "sans" : "display";
  }
  if (bodyToken) {
    const size = bodyToken.fontSize;
    if (typeof size === "string") {
      typeset.size = size;
      record("typography.typesets.default.size", size);
    }
    const lh = bodyToken.lineHeight;
    const leading =
      typeof lh === "number"
        ? lh
        : (() => {
            const a = dimValue(lh);
            const b = dimValue(size);
            return a !== null && b !== null && b !== 0 ? Math.round((a / b) * 1000) / 1000 : null;
          })();
    if (leading !== null && leading > 0) {
      typeset.leading = leading;
      record("typography.typesets.default.leading", String(leading));
    }
  }
  next.typography = {
    ...next.typography,
    fontFamily,
    typesets: { ...(next.typography.typesets ?? {}), default: typeset },
    ...(googleFonts.size > 0 ? { googleFonts: [...googleFonts] } : {}),
  };

  // fontWeight / letterSpacing / fontFeature / fontVariation, and the per-token
  // size ladder, are a scale velloo deliberately does not store: the typeset
  // derives h1..h6 from three controls (see TYPESET_RATIOS).
  return {
    section: "typography",
    count: Object.keys(typographyIn).length,
    reason:
      "velloo derives its type ladder from a typeset (size / leading / flow + font roles), so per-token fontSize / fontWeight / letterSpacing / fontFeature / fontVariation have no home. Font families and the body rhythm were imported.",
  };
}

/** What only the finished mapping can tell the agent about. */
function coverageWarnings(
  next: Theme,
  fm: Frontmatter,
  colorCount: number,
  mapping: ColorMapping,
  opts: MapDesignMdOptions,
): string[] {
  const warnings: string[] = [];
  const semanticTotal = Object.keys(ColorsSchema.shape).length;
  if (colorCount > 0 && mapping.semanticSlots.size === 0) {
    warnings.push(
      `none of the ${semanticTotal} semantic color slots matched — all ${mapping.paletteNames.size} colors landed in \`${mapping.paletteKey}.*\`, which does NOT theme the canvas. ` +
        "This file names its color roles on neither velloo's nor Material 3's vocabulary. " +
        'Map them yourself with set_theme { tokens: { "colors.background": "<a palette value>", … } }.',
    );
  }
  const bg = next.colors.background as string | undefined;
  if (opts.mode === undefined && typeof bg === "string" && looksDark(bg)) {
    warnings.push(
      "this looks like a dark design system (the imported background is darker than its foreground), but it was imported as the LIGHT palette. " +
        'DESIGN.md has no light/dark axis — one file is one palette. Re-run with mode: "dark" to land it in `colorsDark` instead, and import the light file separately.',
    );
  }
  if (opts.mode === "dark") {
    warnings.push(
      'mode: "dark" — only colors were routed to `colorsDark`; typography, radius and spacing are mode-independent and applied to the base theme.',
    );
  }
  if (Array.isArray(fm.omitted) && fm.omitted.length > 0) {
    const names = fm.omitted.map((o) =>
      typeof o === "string" ? o : String((o as { section?: unknown }).section ?? "?"),
    );
    warnings.push(`the file declares these sections intentionally omitted: ${names.join(", ")}.`);
  }
  return warnings;
}

export type MapDesignMdOptions = Pick<ImportDesignMdOptions, "mode">;

/**
 * The mapping, with no folder and no I/O: a DESIGN.md plus the theme it merges
 * onto, in, a merged theme and a full report out. Split from
 * {@link importThemeDesignMd} because `velloo init` has to map a DESIGN.md
 * before a design folder exists to load a theme from.
 */
export function mapDesignMd(
  current: Theme,
  source: string,
  opts: MapDesignMdOptions = {},
): Result<Omit<ImportDesignMdResult, "applied">, ThemeError> {
  const parsed = parseDesignMd(source);
  if (!parsed.ok) return parsed;
  const { fm, body } = parsed.value;
  const tokens = tokensOf(fm);
  if (
    Object.keys(tokens.colors).length === 0 &&
    Object.keys(tokens.rounded).length === 0 &&
    Object.keys(tokens.spacing).length === 0 &&
    Object.keys(tokens.typography).length === 0
  ) {
    return err(
      themeBadRequest(
        "DESIGN.md frontmatter declares no `colors`, `typography`, `rounded` or `spacing` tokens — nothing to import",
      ),
    );
  }

  const warnings: string[] = [];
  if (typeof fm.version === "string" && fm.version !== "alpha") {
    warnings.push(
      `DESIGN.md declares version "${fm.version}"; this importer was written against "alpha" — check for token shapes it may not read.`,
    );
  }

  const mode = opts.mode ?? "light";
  const next = structuredClone(current);
  const changes: ThemeTokenChange[] = [];
  const record: RecordChange = (token, to) => {
    const from = tokenAt(current, token);
    if (from !== to) changes.push({ token, from, to });
  };

  const colors = mapColors(next, tokens.colors, mode, record);
  mapRadius(next, tokens.rounded, record, warnings);
  mapSpacing(next, tokens.spacing, record);
  const dropped: DroppedSection[] = [];
  const typography = mapTypography(next, tokens.typography, record, warnings);
  if (typography) dropped.push(typography);
  if (tokens.componentCount > 0) {
    dropped.push({
      section: "components",
      count: tokens.componentCount,
      reason:
        "velloo has no per-component token store — component styling lives on the nodes. The values are readable in the file; apply the ones you want with update_props.",
    });
  }
  warnings.push(...coverageWarnings(next, fm, Object.keys(tokens.colors).length, colors, opts));

  const validated = ThemeSchema.safeParse(next);
  if (!validated.success) {
    const issue = validated.error.issues[0];
    return err(
      invalidThemePath(
        `imported DESIGN.md tokens produced an invalid theme at "${issue?.path.join(".")}": ${issue?.message ?? "schema mismatch"}`,
      ),
    );
  }

  const slots = Object.keys(ColorsSchema.shape);
  const sections = markdownSections(body);
  return ok({
    designSystem: (fm.name as string).trim(),
    theme: validated.data,
    changes,
    coverage: {
      semantic: colors.semanticSlots.size,
      semanticTotal: slots.length,
      palette: colors.paletteNames.size,
      unmapped: slots.filter((slot) => !colors.semanticSlots.has(slot)),
      aliased: colors.aliased,
    },
    dropped,
    prose: {
      sections: Object.keys(sections).filter((heading) => heading !== ""),
      bytes: body.trim().length,
    },
    warnings,
    mode,
  });
}

/**
 * Code-to-design from a DESIGN.md: merge it into a named theme. Dry-run by
 * default. The prose half is not stored — see {@link ImportDesignMdOptions.sourcePath}.
 */
export async function importThemeDesignMd(
  folder: DesignFolder,
  source: string,
  opts: ImportDesignMdOptions = {},
): Promise<Result<ImportDesignMdResult, ThemeError>> {
  const current = themeByName(folder, opts.themeName ?? "default");
  const mapped = mapDesignMd(current, source, {
    ...(opts.mode !== undefined ? { mode: opts.mode } : {}),
  });
  if (!mapped.ok) return mapped;
  const value = mapped.value;
  if (!opts.apply) return ok({ ...value, applied: false });

  const persisted = await persistNamedTheme(folder, opts.themeName ?? "default", value.theme);
  return ok({ ...value, theme: persisted, applied: true });
}

/** A theme token's current value as the change report shows it. */
function tokenAt(theme: Theme, path: string): string | null {
  const value = at(theme, path);
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (typeof value === "object" && value !== null && "DEFAULT" in value) {
    const d = (value as { DEFAULT?: unknown }).DEFAULT;
    return typeof d === "string" ? d : null;
  }
  return null;
}
