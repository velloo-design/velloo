/**
 * Tailwind v4 → v3 class-vocabulary compatibility. The canvas always compiles
 * designs with the v4 engine, so class names in a design carry v4 semantics;
 * when the host app is still on Tailwind v3 the emitted classes need a
 * downlevel pass. This module is advisory, not a rewriter: emit_code is an
 * agent-consumed IR, so the agent applies the renames while writing the real
 * file. Table follows the official v4 upgrade guide's rename list.
 */

export interface V3ClassIssue {
  /** The class as it appears in the design (v4 vocabulary). */
  class: string;
  /** Drop-in v3 equivalent, when a mechanical rename preserves the visual. */
  v3?: string;
  note: string;
}

/** v4 base utility → the v3 spelling with the same rendered result. */
const UTILITY_RENAMES: ReadonlyMap<string, string> = new Map([
  ["shadow-xs", "shadow-sm"],
  ["shadow-sm", "shadow"],
  ["drop-shadow-xs", "drop-shadow-sm"],
  ["drop-shadow-sm", "drop-shadow"],
  ["blur-xs", "blur-sm"],
  ["blur-sm", "blur"],
  ["backdrop-blur-xs", "backdrop-blur-sm"],
  ["backdrop-blur-sm", "backdrop-blur"],
  ["outline-hidden", "outline-none"],
]);

/** rounded / rounded-<side> track the same xs/sm → sm/<bare> shift. */
const ROUNDED_RENAME = /^(rounded(?:-(?:s|e|t|r|b|l|ss|se|es|ee|tl|tr|br|bl))?)-(xs|sm)$/;

const GRADIENT_RENAME = /^bg-linear-to-(t|tr|r|br|b|bl|l|tl)$/;

/** v4-only utility families with no mechanical v3 equivalent. */
const V4_ONLY_UTILITIES: ReadonlyArray<[RegExp, string]> = [
  [/^inset-shadow(-|$)/, "inset shadows are v4-only — approximate with shadow-[inset_…]"],
  [/^inset-ring(-|$)/, "inset rings are v4-only — approximate with shadow-[inset_…]"],
  [/^field-sizing-/, "field-sizing is v4-only — needs custom CSS in v3"],
  [/^text-shadow(-|$)/, "text shadows are v4-only — needs custom CSS in v3"],
  [/^scheme-/, "color-scheme utilities are v4-only — needs custom CSS in v3"],
  [/^mask-/, "mask utilities are v4-only — needs custom CSS in v3"],
  [
    /^bg-(radial|conic)(-|$)/,
    "radial/conic gradient utilities are v4-only — use an arbitrary background-image in v3",
  ],
  [
    /^bg-linear-/,
    "angle-based bg-linear-* is v4-only — v3 only has bg-gradient-to-<dir> or an arbitrary background-image",
  ],
];

/** v4-only variant prefixes (matched against each `:`-separated segment). */
const V4_ONLY_VARIANTS: ReadonlyArray<[RegExp, string]> = [
  [/^starting$/, "the starting: variant (@starting-style) is v4-only"],
  [/^inert$/, "the inert: variant is v4-only"],
  [/^not-/, "the not-* variant is v4-only"],
  [/^in-/, "the in-* variant is v4-only"],
  [/^nth-/, "the nth-* variants are v4-only"],
  [/^\*\*$/, "the **: descendant variant is v4-only"],
  [
    /^@/,
    "container-query variants need the @tailwindcss/container-queries plugin (and a @container parent) in v3",
  ],
];

/** Split a class into variant segments + base at top-level colons only. */
function splitVariants(cls: string): string[] {
  const segments: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < cls.length; i++) {
    const ch = cls[i];
    if (ch === "[" || ch === "(") depth++;
    else if (ch === "]" || ch === ")") depth = Math.max(0, depth - 1);
    else if (ch === ":" && depth === 0) {
      segments.push(cls.slice(start, i));
      start = i + 1;
    }
  }
  segments.push(cls.slice(start));
  return segments;
}

function baseIssue(cls: string, variants: string[], base: string): V3ClassIssue | null {
  // Negative (`-mt-2`) and important (v4 trailing `!`) wrappers around the utility.
  const negative = base.startsWith("-") ? "-" : "";
  const important = base.endsWith("!");
  const bare = base.slice(negative.length, important ? -1 : undefined);

  const withWrappers = (renamed: string): string => {
    // v3 puts important FIRST (`!shadow`), v4 LAST (`shadow!`).
    const v3Base = `${important ? "!" : ""}${negative}${renamed}`;
    return [...variants, v3Base].join(":");
  };

  const renamed = UTILITY_RENAMES.get(bare);
  if (renamed !== undefined) {
    const ringNote =
      bare === "outline-hidden"
        ? "v3 outline-none keeps a transparent outline for forced-colors mode — usually the intent"
        : "v4 shifted this size ladder down one step";
    return { class: cls, v3: withWrappers(renamed), note: ringNote };
  }
  if (bare === "ring") {
    return {
      class: cls,
      v3: withWrappers("ring-1"),
      note: "v4 ring is 1px (v3 ring is 3px); v3 also defaults ring color to blue-500 — pair with an explicit ring-<color>",
    };
  }
  if (bare === "ring-3") {
    return {
      class: cls,
      v3: withWrappers("ring"),
      note: "v3 spells the 3px ring as bare `ring`; its default color is blue-500 — pair with an explicit ring-<color>",
    };
  }
  const rounded = ROUNDED_RENAME.exec(bare);
  if (rounded) {
    const v3Name = rounded[2] === "xs" ? `${rounded[1]}-sm` : (rounded[1] as string);
    return {
      class: cls,
      v3: withWrappers(v3Name),
      note: "v4 shifted the rounded ladder down one step",
    };
  }
  const gradient = GRADIENT_RENAME.exec(bare);
  if (gradient) {
    return {
      class: cls,
      v3: withWrappers(`bg-gradient-to-${gradient[1]}`),
      note: "v3 spells directional gradients bg-gradient-to-<dir>",
    };
  }
  for (const [pattern, note] of V4_ONLY_UTILITIES) {
    if (pattern.test(bare)) return { class: cls, note };
  }
  // v4 shorthand for CSS-var arbitrary values: `bg-(--brand)` ⇒ v3 `bg-[var(--brand)]`.
  const varShorthand = /^([a-z][a-z0-9-]*)-\((--[a-zA-Z0-9-]+)\)$/.exec(bare);
  if (varShorthand) {
    return {
      class: cls,
      v3: withWrappers(`${varShorthand[1]}-[var(${varShorthand[2]})]`),
      note: "the (--var) arbitrary-value shorthand is v4-only",
    };
  }
  if (important) {
    return {
      class: cls,
      v3: withWrappers(bare),
      note: "v3 puts the important marker first (`!utility`), v4 last (`utility!`)",
    };
  }
  return null;
}

/**
 * Report the classes in `classes` that won't compile — or will render
 * differently — under Tailwind v3, each with a drop-in `v3` spelling when a
 * mechanical rename exists. Variant-aware (`hover:shadow-xs` maps too).
 * Classes it doesn't flag are spelled the same in both majors. Opacity
 * modifiers (`bg-primary/50`) are not flagged: the emitted v3 preset plumbs
 * `<alpha-value>` so they keep working.
 */
export function v3ClassIssues(classes: Iterable<string>): V3ClassIssue[] {
  const issues: V3ClassIssue[] = [];
  const seen = new Set<string>();
  for (const cls of classes) {
    if (cls === "" || seen.has(cls)) continue;
    seen.add(cls);
    const segments = splitVariants(cls);
    const base = segments[segments.length - 1] as string;
    const variants = segments.slice(0, -1);

    const variantHit = variants
      .flatMap((v) => V4_ONLY_VARIANTS.filter(([p]) => p.test(v)).map(([, note]) => note))
      .at(0);
    if (variantHit !== undefined) {
      issues.push({ class: cls, note: variantHit });
      continue;
    }
    const issue = baseIssue(cls, variants, base);
    if (issue) issues.push(issue);
  }
  return issues;
}

/** Unique class names appearing in emitted JSX (`className="…"` attributes). */
export function classNamesInJsx(jsx: string): string[] {
  const out = new Set<string>();
  const attr = /className="([^"]*)"/g;
  let m = attr.exec(jsx);
  while (m !== null) {
    for (const cls of (m[1] as string).split(/\s+/)) {
      if (cls !== "") out.add(cls);
    }
    m = attr.exec(jsx);
  }
  return [...out];
}
