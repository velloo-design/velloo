/**
 * The typeset derivation — velloo's one home for typographic proportion.
 *
 * A typeset is three rhythm controls (size / leading / flow) plus font roles.
 * Everything else — the h1..h6 ladder, body/lead/small copy, the space under a
 * heading, list indents — derives from them through `TYPESET_RATIOS`. An agent
 * reasons about three knobs far more reliably than a twelve-entry scale, and one
 * ratio table means the canvas, the emitted CSS, the native framework themes,
 * and the Heading/Text components cannot drift apart.
 *
 * Deliberately zod-free and exported as `@velloo/schema/typeset` so the canvas,
 * the helpers, and the providers can import the tables without pulling zod into
 * a browser bundle. The Zod shape lives in `theme.ts` and re-uses these types.
 *
 * Two output modes over the same ratios:
 *  - `typesetCss` / `typesetVars` — CSS custom properties, for every channel
 *    that renders through a stylesheet (Tailwind utilities, inline `style`, the
 *    `:where()` element rules). Values stay symbolic, so a rhythm change
 *    re-flows every frame without re-rendering.
 *  - `typesetScale` — the same ratios resolved to concrete numbers, for the
 *    native framework themes (MUI/antd/chakra), whose theme objects get
 *    serialized into codegen artifacts where no CSS variables exist.
 */

import { isCssIdent, sanitizeCssTokenValue } from "./css-sanitize.ts";

/** The three rhythm controls plus font roles. Every field is optional; `TYPESET_DEFAULT` fills the gaps. */
export interface Typeset {
  /** Base text size. `1em` follows the surrounding layout (the container-relative default). */
  size?: string | number;
  /** Body line-height, unitless. Heading leading derives from it. */
  leading?: number;
  /** Vertical space between blocks. Heading margins and rule spacing derive from it. */
  flow?: string | number;
  /** Font *role* name (a key of `typography.fontFamily`) for body copy. */
  fontBody?: string;
  /** Font role name for headings. */
  fontHeading?: string;
  /** Font role name for code. */
  fontMono?: string;
}

/** Baseline rhythm — shadcn/typeset's defaults, which read well on long-form content. */
export const TYPESET_DEFAULT: Required<Pick<Typeset, "size" | "leading" | "flow">> = {
  size: "1em",
  leading: 1.75,
  flow: "1.25em",
};

/** The name of the typeset every folder has: the baseline projected onto `:root`. */
export const DEFAULT_TYPESET_NAME = "default";

/**
 * Typeset names are emitted as `.typeset-<name>` class selectors, so they must be
 * safe idents. `default` is reserved for the folder baseline (it lands on
 * `:root` and on `.typeset`, not on a preset class).
 */
export function isTypesetName(name: string): boolean {
  return isCssIdent(name);
}

/**
 * Roles in the derived scale. Fixed vocabulary — the *values* vary per typeset,
 * the names never do, which is what lets the class literals live in a shared
 * module and be safelisted rather than scanned.
 *
 * Names are chosen to stay clear of the theme's other Tailwind namespaces: a
 * size token becomes a `text-<role>` utility, which would collide with the
 * `text-<color>` utility that `--color-<name>` generates. Hence `caption` rather
 * than `muted` — `muted` is a semantic color slot in every velloo theme.
 */
export type TypesetRole =
  | "h1"
  | "h2"
  | "h3"
  | "h4"
  | "h5"
  | "h6"
  | "body"
  | "lead"
  | "small"
  | "caption";

export interface TypesetRatio {
  /** Multiplier on the typeset's base size. */
  size: number;
  /** Multiplier on the typeset's leading — so a leading change moves the whole ladder proportionally. */
  leading: number;
  /** Letter-spacing, in `em` of the role's own size. Optical, so it does not scale with rhythm. */
  tracking: string;
  /** Font weight. Constant per role: weight is deliberately not one of the three controls. */
  weight: 400 | 500 | 600 | 700;
  /** Which font role paints this — headings take the heading face, copy takes the body face. */
  face: "heading" | "body";
}

/**
 * The ratio table. **The only place typographic proportion is written down.**
 * `typesetVars`, `typesetCss`, and `typesetScale` all read it, which is what
 * replaced four hand-synced class tables (helpers' Tailwind ladder, its codegen
 * mirror, provider-none's inline ladder, and that ladder's codegen mirror).
 */
export const TYPESET_RATIOS: Record<TypesetRole, TypesetRatio> = {
  h1: { size: 2.5, leading: 0.63, tracking: "-0.025em", weight: 700, face: "heading" },
  h2: { size: 2, leading: 0.66, tracking: "-0.025em", weight: 700, face: "heading" },
  h3: { size: 1.5, leading: 0.71, tracking: "-0.02em", weight: 600, face: "heading" },
  h4: { size: 1.25, leading: 0.74, tracking: "-0.02em", weight: 600, face: "heading" },
  h5: { size: 1.125, leading: 0.8, tracking: "-0.015em", weight: 600, face: "heading" },
  h6: { size: 1, leading: 0.8, tracking: "-0.01em", weight: 600, face: "heading" },
  body: { size: 1, leading: 1, tracking: "0em", weight: 400, face: "body" },
  lead: { size: 1.25, leading: 0.91, tracking: "0em", weight: 400, face: "body" },
  small: { size: 0.875, leading: 0.57, tracking: "0em", weight: 500, face: "body" },
  caption: { size: 0.875, leading: 0.86, tracking: "0em", weight: 400, face: "body" },
};

/** Every role name, in ladder order. Drives the `@theme` tokens, the Tailwind safelist, and the twMerge config. */
export const TYPESET_SCALE_NAMES: readonly TypesetRole[] = Object.keys(
  TYPESET_RATIOS,
) as TypesetRole[];

/** Heading level → scale role. */
export const HEADING_ROLE_BY_LEVEL: Record<number, TypesetRole> = {
  1: "h1",
  2: "h2",
  3: "h3",
  4: "h4",
  5: "h5",
  6: "h6",
};

/** The `Text` helper's visual variants. */
export type TextVariant = "default" | "muted" | "small" | "lead";

/** Text variant → scale role. */
export const TEXT_ROLE_BY_VARIANT: Record<TextVariant, TypesetRole> = {
  default: "body",
  muted: "caption",
  small: "small",
  lead: "lead",
};

/**
 * The semantic color slot each text variant paints with, or absent to inherit.
 * Colour is not part of the typeset — it lives here only so the four channels
 * that lower `Text` (Tailwind runtime + codegen, inline runtime + codegen) read
 * one table instead of four.
 */
export const TEXT_TONE_BY_VARIANT: Partial<Record<TextVariant, string>> = {
  default: "foreground",
  muted: "muted-foreground",
  lead: "muted-foreground",
};

/** Stock Tailwind weight utility per weight value. */
const WEIGHT_CLASS: Record<TypesetRatio["weight"], string> = {
  400: "font-normal",
  500: "font-medium",
  600: "font-semibold",
  700: "font-bold",
};

/**
 * The Tailwind utilities each role resolves to. Fixed literal class names whose
 * *values* come from the theme's generated `@theme` tokens — which is what lets
 * these strings live in a plain `.ts` module: the JIT learns them from the
 * generated `@source inline(...)` safelist rather than from scanning a `.tsx`.
 *
 * Weight uses the stock utility rather than a themed token: weight is constant
 * per role, and a `--font-weight-<role>` token would generate a `font-<role>`
 * utility that collides with the `font-<role>` a font *family* declares.
 */
export const TYPESET_CLASSES: Record<TypesetRole, string> = Object.fromEntries(
  TYPESET_SCALE_NAMES.map((role) => {
    const ratio = TYPESET_RATIOS[role];
    return [
      role,
      `text-${role} leading-${role} tracking-${role} ${WEIGHT_CLASS[ratio.weight]}`,
    ] as const;
  }),
) as Record<TypesetRole, string>;

/**
 * The inline `style` object each role resolves to, for the `none`-CSS channel.
 * Sizes are `var()` references into the same derived tokens the utilities read,
 * so a `none/none` folder gets themed type and re-rhythms live like every other
 * channel; weight is a literal because it never varies with rhythm.
 */
export const TYPESET_INLINE_STYLE: Record<
  TypesetRole,
  { fontSize: string; lineHeight: string; letterSpacing: string; fontWeight: number }
> = Object.fromEntries(
  TYPESET_SCALE_NAMES.map((role) => [
    role,
    {
      fontSize: `var(--text-${role})`,
      lineHeight: `var(--leading-${role})`,
      letterSpacing: `var(--tracking-${role})`,
      fontWeight: TYPESET_RATIOS[role].weight,
    },
  ]),
) as Record<
  TypesetRole,
  { fontSize: string; lineHeight: string; letterSpacing: string; fontWeight: number }
>;

/** Clamp an authored heading level to 1–6, so the tag and the ladder rung always agree. */
export function resolveHeadingLevel(level: unknown): number {
  const n = Number(level ?? 1);
  return Number.isFinite(n) && n >= 1 && n <= 6 ? Math.trunc(n) : 1;
}

function textVariant(variant: unknown): TextVariant {
  const v = String(variant ?? "default");
  return v in TEXT_ROLE_BY_VARIANT ? (v as TextVariant) : "default";
}

/**
 * The Tailwind classes a `Heading` of this level renders with. THE definition —
 * the runtime component and the codegen lowering both call this, which is what
 * retired the hand-synced `lowering.ts` mirror.
 */
export function headingClasses(level: unknown): string {
  const role = HEADING_ROLE_BY_LEVEL[resolveHeadingLevel(level)] as TypesetRole;
  return TYPESET_CLASSES[role];
}

/** The Tailwind classes a `Text` of this variant renders with, tone included. */
export function textClasses(variant: unknown): string {
  const v = textVariant(variant);
  const tone = TEXT_TONE_BY_VARIANT[v];
  return tone
    ? `${TYPESET_CLASSES[TEXT_ROLE_BY_VARIANT[v]]} text-${tone}`
    : TYPESET_CLASSES[TEXT_ROLE_BY_VARIANT[v]];
}

/** The inline `style` a `Heading` of this level renders with, on the `none`-CSS channel. */
export function headingInlineStyle(level: unknown): Record<string, string | number> {
  const role = HEADING_ROLE_BY_LEVEL[resolveHeadingLevel(level)] as TypesetRole;
  return { ...TYPESET_INLINE_STYLE[role] };
}

/** The inline `style` a `Text` of this variant renders with, on the `none`-CSS channel. */
export function textInlineStyle(variant: unknown): Record<string, string | number> {
  const v = textVariant(variant);
  const tone = TEXT_TONE_BY_VARIANT[v];
  return {
    ...TYPESET_INLINE_STYLE[TEXT_ROLE_BY_VARIANT[v]],
    ...(tone ? { color: `var(--color-${tone})` } : {}),
  };
}

/**
 * `@source inline(...)` arguments covering every utility the scale can produce.
 * Emitted with the generated `@theme` block so the utilities compile whether or
 * not a class literal happens to be scanned — the mechanism that let the ladder
 * move out of `heading.tsx` into a shared module.
 */
export function typesetSafelist(): string[] {
  const roles = TYPESET_SCALE_NAMES.join(",");
  const weights = Object.values(WEIGHT_CLASS)
    .map((c) => c.replace(/^font-/, ""))
    .join(",");
  // The tone classes ride along: `textClasses` composes them from the same
  // unscanned module, so they need the same treatment as the scale itself.
  const tones = [...new Set(Object.values(TEXT_TONE_BY_VARIANT))].join(",");
  return [`{text,leading,tracking}-{${roles}}`, `font-{${weights}}`, `text-{${tones}}`];
}

/**
 * Every utility class the scale can produce, deduped. Tailwind v3 has no
 * `@source inline(...)`, so its emitted preset safelists this list instead.
 */
export function typesetUtilityClasses(): string[] {
  const seen = new Set<string>();
  for (const classes of Object.values(TYPESET_CLASSES)) {
    for (const cls of classes.split(" ")) seen.add(cls);
  }
  for (const tone of Object.values(TEXT_TONE_BY_VARIANT)) seen.add(`text-${tone}`);
  return [...seen];
}

/**
 * The scale as a Tailwind v3 `theme.extend.fontSize` map. Each entry carries its
 * paired leading and tracking, and every value is a `var()` into the typeset
 * sheet — so a v3 app re-derives inside a `.typeset-<preset>` region exactly
 * like a v4 one.
 */
export function typesetV3FontSize(): Record<
  string,
  [string, { lineHeight: string; letterSpacing: string }]
> {
  return Object.fromEntries(
    TYPESET_SCALE_NAMES.map((role) => [
      role,
      [
        `var(--text-${role})`,
        { lineHeight: `var(--leading-${role})`, letterSpacing: `var(--tracking-${role})` },
      ],
    ]),
  );
}

/**
 * Placeholder `@theme` tokens so `text-<role>` / `leading-<role>` /
 * `tracking-<role>` exist as utilities. Values here are irrelevant — the JIT
 * only needs the token to be declared, and `typesetCss` overrides every one of
 * them at render time (same contract as the `--font-<role>` tokens).
 */
export function typesetThemeTokens(): string[] {
  const lines: string[] = [];
  for (const role of TYPESET_SCALE_NAMES) {
    const ratio = TYPESET_RATIOS[role];
    lines.push(`  --text-${role}: ${ratio.size}rem;`);
    lines.push(`  --leading-${role}: ${round(ratio.leading * TYPESET_DEFAULT.leading)};`);
    lines.push(`  --tracking-${role}: ${ratio.tracking};`);
  }
  return lines;
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** A length authored as a bare number means px, matching the rest of the theme's token handling. */
function len(value: string | number): string {
  return typeof value === "number" ? `${value}px` : sanitizeCssTokenValue(value);
}

/** Resolve a font *role* name to the `var(--font-<role>)` reference, or a fallback when unset/unsafe. */
function faceVar(role: string | undefined, fallback: string): string {
  if (!role || !isCssIdent(role)) return fallback;
  return `var(--font-${role})`;
}

/** Fill a partial typeset from the baseline. */
export function resolveTypeset(typeset: Typeset | undefined): Typeset & {
  size: string | number;
  leading: number;
  flow: string | number;
} {
  return {
    ...typeset,
    size: typeset?.size ?? TYPESET_DEFAULT.size,
    leading: typeset?.leading ?? TYPESET_DEFAULT.leading,
    flow: typeset?.flow ?? TYPESET_DEFAULT.flow,
  };
}

/**
 * The authored rhythm controls, as CSS declarations. Presets override exactly
 * these — and *only* these.
 *
 * `partial` is the difference between the baseline and a preset. The baseline
 * (`:root` / `.typeset`) fills every control from `TYPESET_DEFAULT` so the vars
 * always resolve. A preset emits only what it authored, because it inherits the
 * rest: a `.typeset-compact` that restated `--typeset-font-heading` would reset
 * the folder's display face to the body font just by changing the size.
 */
export function typesetBaseVars(
  typeset: Typeset | undefined,
  indent = "  ",
  partial = false,
): string[] {
  const t = partial ? (typeset ?? {}) : resolveTypeset(typeset);
  const lines: string[] = [];
  const push = (name: string, value: string) => lines.push(`${indent}--typeset-${name}: ${value};`);
  if (t.size !== undefined) push("size", len(t.size));
  if (t.leading !== undefined) push("leading", String(round(t.leading)));
  if (t.flow !== undefined) push("flow", len(t.flow));
  if (!partial || t.fontBody !== undefined) {
    push("font-body", faceVar(t.fontBody, "inherit"));
  }
  if (!partial || t.fontHeading !== undefined) {
    push("font-heading", faceVar(t.fontHeading, "var(--typeset-font-body)"));
  }
  if (!partial || t.fontMono !== undefined) {
    push("font-mono", faceVar(t.fontMono, "var(--font-mono, ui-monospace, monospace)"));
  }
  return lines;
}

/**
 * The derived scale, as CSS declarations referencing the authored controls.
 *
 * These MUST be emitted in the same rule as the authored controls. Custom
 * property substitution resolves `var()` against the referencing element's own
 * cascaded value, so co-locating them means a preset that overrides
 * `--typeset-size` on the element re-derives the whole ladder for that subtree —
 * and the `text-h1` utility and the `:where(.typeset h1)` rule then compute the
 * *same* value, with no specificity fight to arbitrate.
 */
export function typesetVars(indent = "  "): string[] {
  const lines: string[] = [`${indent}--typeset-rhythm: var(--typeset-size);`];
  for (const role of TYPESET_SCALE_NAMES) {
    const ratio = TYPESET_RATIOS[role];
    const size =
      ratio.size === 1 ? "var(--typeset-rhythm)" : `calc(var(--typeset-rhythm) * ${ratio.size})`;
    const leading =
      ratio.leading === 1
        ? "var(--typeset-leading)"
        : `calc(var(--typeset-leading) * ${ratio.leading})`;
    lines.push(`${indent}--text-${role}: ${size};`);
    lines.push(`${indent}--leading-${role}: ${leading};`);
    lines.push(`${indent}--tracking-${role}: ${ratio.tracking};`);
  }
  return lines;
}

/** Width under which the base size gets a small bump, so phone-width frames read comfortably. */
const NARROW_BREAKPOINT = "48rem";
const NARROW_BUMP = 1.125;

/**
 * The narrow-width bump rides on the *derived* `--typeset-rhythm` rather than on
 * the authored `--typeset-size`, so it applies to every preset automatically
 * without each one restating it.
 */
function rhythmBump(selector: string): string[] {
  return [
    `@media (width < ${NARROW_BREAKPOINT}) {`,
    `  ${selector} {`,
    `    --typeset-rhythm: calc(var(--typeset-size) * ${NARROW_BUMP});`,
    "  }",
    "}",
  ];
}

/**
 * Element rules for a typeset region. Every selector is fully `:where()`-wrapped
 * so the whole block has zero specificity and any authored utility or inline
 * style wins. Spacing is `margin-block-start` only, with no `:last-child` /
 * `:has()` / `:empty` — matching upstream's streaming guarantee that appending a
 * block never restyles the ones before it.
 */
function typesetElementRules(): string[] {
  const flow = "var(--typeset-flow)";
  const rules: string[] = [
    ":where(.typeset) {",
    "  font-family: var(--typeset-font-body);",
    "  font-size: var(--typeset-rhythm);",
    "  line-height: var(--typeset-leading);",
    "}",
  ];

  for (const level of [1, 2, 3, 4, 5, 6]) {
    const role = HEADING_ROLE_BY_LEVEL[level] as TypesetRole;
    // Bigger headings earn more air above them; the multiplier rides on flow so
    // the whole vertical rhythm still moves with one control.
    const space = round(1.9 - (level - 1) * 0.15);
    rules.push(
      `:where(.typeset h${level}) {`,
      "  font-family: var(--typeset-font-heading);",
      `  font-size: var(--text-${role});`,
      `  line-height: var(--leading-${role});`,
      `  letter-spacing: var(--tracking-${role});`,
      `  font-weight: ${TYPESET_RATIOS[role].weight};`,
      `  margin-block-start: calc(${flow} * ${space});`,
      "  margin-block-end: 0;",
      "  text-wrap: balance;",
      "}",
    );
  }

  rules.push(
    ":where(.typeset p, .typeset ul, .typeset ol, .typeset blockquote, .typeset pre, .typeset table, .typeset figure) {",
    `  margin-block-start: ${flow};`,
    "  margin-block-end: 0;",
    "}",
    ":where(.typeset > :first-child) {",
    "  margin-block-start: 0;",
    "}",
    ":where(.typeset ul, .typeset ol) {",
    `  padding-inline-start: calc(${flow} * 1.25);`,
    "}",
    ":where(.typeset ul) { list-style: disc; }",
    ":where(.typeset ol) { list-style: decimal; }",
    ":where(.typeset li) {",
    `  margin-block-start: calc(${flow} * 0.4);`,
    "}",
    ":where(.typeset li)::marker {",
    "  color: var(--color-muted-foreground, currentColor);",
    "}",
    ":where(.typeset blockquote) {",
    `  padding-inline-start: ${flow};`,
    "  border-inline-start: 2px solid var(--color-border, currentColor);",
    "  color: var(--color-muted-foreground, inherit);",
    "  font-style: italic;",
    "}",
    ":where(.typeset code) {",
    "  font-family: var(--typeset-font-mono);",
    "  font-size: 0.875em;",
    "  border-radius: calc(var(--radius, 0.5rem) * 0.5);",
    "  background: var(--color-muted, transparent);",
    "  padding: 0.15em 0.35em;",
    "}",
    ":where(.typeset pre) {",
    "  font-family: var(--typeset-font-mono);",
    `  padding: ${flow};`,
    "  border-radius: var(--radius, 0.5rem);",
    "  background: var(--color-muted, transparent);",
    "  overflow-x: auto;",
    "}",
    ":where(.typeset pre code) {",
    "  background: none;",
    "  padding: 0;",
    "  font-size: 0.875em;",
    "}",
    ":where(.typeset a) {",
    "  color: inherit;",
    "  text-decoration: underline;",
    "  text-underline-offset: 0.2em;",
    "}",
    ":where(.typeset strong) { font-weight: 600; }",
    ":where(.typeset small) {",
    "  font-size: var(--text-small);",
    "  line-height: var(--leading-small);",
    "}",
    ":where(.typeset hr) {",
    `  margin-block-start: calc(${flow} * 1.6);`,
    "  margin-block-end: 0;",
    "  border: 0;",
    "  border-block-start: 1px solid var(--color-border, currentColor);",
    "}",
    ":where(.typeset table) {",
    "  width: 100%;",
    "  border-collapse: collapse;",
    "  font-size: var(--text-caption);",
    "  line-height: var(--leading-caption);",
    "}",
    ":where(.typeset th, .typeset td) {",
    `  padding: calc(${flow} * 0.4) calc(${flow} * 0.6);`,
    "  border-block-end: 1px solid var(--color-border, currentColor);",
    "  text-align: start;",
    "}",
    ":where(.typeset th) { font-weight: 600; }",
    ":where(.typeset img, .typeset video) {",
    "  max-width: 100%;",
    "  height: auto;",
    "  border-radius: var(--radius, 0.5rem);",
    "}",
  );

  return rules;
}

export interface TypesetCssOptions {
  /**
   * Emit the `:root` baseline (the folder default projected globally, so
   * `text-h1` works outside a typeset region). The `.typeset` region rules are
   * always emitted. Defaults to true.
   */
  root?: boolean;
}

/**
 * The complete typeset stylesheet for a folder's typesets. One generator, used
 * verbatim by the renderer (canvas + screenshots) and by `emit_theme` (the
 * `typeset.css` artifact) so the design and the generated app cannot diverge.
 */
export function typesetCss(
  typesets: Record<string, Typeset> | undefined,
  options: TypesetCssOptions = {},
): string {
  const all = typesets ?? {};
  const base = all[DEFAULT_TYPESET_NAME];
  const blocks: string[] = [];

  if (options.root !== false) {
    blocks.push([":root {", ...typesetBaseVars(base), ...typesetVars(), "}"].join("\n"));
    blocks.push(rhythmBump(":root").join("\n"));
  }

  // The region baseline. Authored controls and the derived scale share this rule
  // so a preset class on the same element re-derives the ladder.
  blocks.push([".typeset {", ...typesetBaseVars(base), ...typesetVars(), "}"].join("\n"));
  blocks.push(rhythmBump(".typeset").join("\n"));

  for (const [name, typeset] of Object.entries(all)) {
    if (name === DEFAULT_TYPESET_NAME) continue;
    if (!isTypesetName(name)) continue;
    // Presets override the authored controls only — the derived scale declared
    // on `.typeset` re-substitutes against these on the same element. And only
    // the controls the preset actually authored, so tuning one does not silently
    // reset the others to the baseline.
    const declarations = typesetBaseVars(typeset, "  ", true);
    if (declarations.length === 0) continue;
    blocks.push([`.typeset-${name} {`, ...declarations, "}"].join("\n"));
  }

  blocks.push(typesetElementRules().join("\n"));

  return blocks.join("\n\n");
}

/** A role's proportions resolved to concrete values, for native framework themes. */
export interface ResolvedTypesetRole {
  /** Font size in px. */
  fontSize: number;
  /** Unitless line-height. */
  lineHeight: number;
  /** Letter-spacing, as an `em` string. */
  letterSpacing: string;
  fontWeight: number;
  /** The resolved font stack for this role's face, when the typeset names one. */
  fontFamily?: string;
}

export type TypesetScale = Record<TypesetRole, ResolvedTypesetRole>;

export interface TypesetScaleOptions {
  /**
   * Pixel value for a relative base size. The default `1em` is
   * container-relative, which a serialized framework theme cannot express, so
   * native adapters resolve it against the document root.
   */
  rootPx?: number;
  /** `typography.fontFamily`, for resolving `fontBody` / `fontHeading` roles to real stacks. */
  fontFamily?: Record<string, string>;
}

const DEFAULT_ROOT_PX = 16;

/**
 * Resolve an authored length to px. Relative units scale `rootPx` by their
 * factor. Exported because every surface that turns an authored control back
 * into a number — the native scale below, the canvas's rhythm sliders — has to
 * agree on what `"1em"` and a bare `15` mean.
 */
export function typesetSizePx(size: string | number, rootPx = DEFAULT_ROOT_PX): number {
  if (typeof size === "number") return size;
  const match = /^(-?[\d.]+)\s*(px|rem|em|%)?$/.exec(size.trim());
  if (!match) return rootPx;
  const n = Number.parseFloat(match[1] as string);
  if (!Number.isFinite(n)) return rootPx;
  switch (match[2]) {
    case "px":
    case undefined:
      return n;
    case "%":
      return (n / 100) * rootPx;
    default:
      return n * rootPx;
  }
}

/**
 * The same ratios as `typesetVars`, resolved to concrete values. Native adapters
 * (MUI/antd/chakra) project this onto their own typography scales, and the very
 * same call feeds both the canvas mount and the emitted theme artifact — so a
 * preview and generated code cannot disagree.
 */
export function typesetScale(
  typeset: Typeset | undefined,
  options: TypesetScaleOptions = {},
): TypesetScale {
  const t = resolveTypeset(typeset);
  const rootPx = options.rootPx ?? DEFAULT_ROOT_PX;
  const basePx = typesetSizePx(t.size, rootPx);
  const families = options.fontFamily ?? {};
  const headingStack = t.fontHeading ? families[t.fontHeading] : undefined;
  const bodyStack = t.fontBody ? families[t.fontBody] : undefined;

  const out = {} as TypesetScale;
  for (const role of TYPESET_SCALE_NAMES) {
    const ratio = TYPESET_RATIOS[role];
    const stack = ratio.face === "heading" ? (headingStack ?? bodyStack) : bodyStack;
    out[role] = {
      fontSize: round(basePx * ratio.size),
      lineHeight: round(t.leading * ratio.leading),
      letterSpacing: ratio.tracking,
      fontWeight: ratio.weight,
      ...(stack ? { fontFamily: stack } : {}),
    };
  }
  return out;
}
