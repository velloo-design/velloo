/**
 * What the theme says a node should look like, per HUD control.
 *
 * The HUD's whole claim is that you can see the default and see when you've
 * left it. That needs a second value alongside whatever the node's own classes
 * say — and for typography the theme genuinely has one: the typeset ladder
 * resolves h1 to a size, a leading, a weight and a face. Spacing, size and
 * colour have no such ladder, so they are deliberately absent here rather than
 * filled with a plausible-looking zero.
 */

import type { Node, Theme, TypesetRole } from "@velloo/schema";
import { nodeTypography } from "../node-typography.ts";
import { roleOf } from "./control-set.ts";
import { fontArgToPx, leadingToRatio } from "./values.ts";

/** Ladder rung → the name a person would use for it. */
const ROLE_LABEL: Record<TypesetRole, string> = {
  h1: "Heading 1",
  h2: "Heading 2",
  h3: "Heading 3",
  h4: "Heading 4",
  h5: "Heading 5",
  h6: "Heading 6",
  body: "Body",
  lead: "Lead",
  small: "Small",
  caption: "Caption",
};

/** Numeric weight → the Tailwind token the weight control speaks in. */
const WEIGHT_TOKEN: Record<number, string> = {
  100: "thin",
  200: "extralight",
  300: "light",
  400: "normal",
  500: "medium",
  600: "semibold",
  700: "bold",
  800: "extrabold",
  900: "black",
};

export interface ThemeReadout {
  /** Theme value per control id — only the controls the theme has an opinion on. */
  readonly values: Readonly<Record<string, string | number | null>>;
  /** The style those values come from, e.g. "Heading 1". */
  readonly source?: string;
  /**
   * Per-control caveat. The bar edits base-width utilities, so a `md:text-7xl`
   * in play means the number on screen isn't the number in the field — better
   * said out loud than quietly wrong.
   */
  readonly notes?: Readonly<Record<string, string>>;
}

const EMPTY: ThemeReadout = { values: {} };

/** Which control a responsive utility would be talking about. */
const RESPONSIVE_CONTROL: [prefix: string, control: string][] = [
  ["leading-", "leading"],
  ["tracking-", "tracking"],
  ["font-", "weight"],
  ["text-", "size"],
];

export interface ThemeReadoutInput {
  readonly theme: Theme | null | undefined;
  /** Screen root — a typeset applies to a subtree, so the node alone can't say which. */
  readonly tree: Node | undefined;
  readonly path: number[];
  readonly node: Node;
}

/**
 * Resolve the theme side of every control for one node. Returns nothing for
 * non-typographic nodes, which is the honest answer: a Box's padding has no
 * default to fall back to.
 */
export function themeReadout({ theme, tree, path, node }: ThemeReadoutInput): ThemeReadout {
  const role = roleOf(node);
  if (role !== "heading" && role !== "text") return EMPTY;
  if (!theme || !tree) return EMPTY;

  // A `Box` carrying a string isn't on the ladder itself — it inherits from
  // whichever ancestor is, exactly as CSS does. Showing nothing for it would be
  // worse than showing where the text actually gets its size from.
  const found = nearestRung(theme, tree, path, node);
  if (!found) return EMPTY;
  const { facts, inherited } = found;

  const { resolved, face } = facts;
  const rung = facts.region
    ? `${ROLE_LABEL[facts.role]} · ${facts.region.name}`
    : ROLE_LABEL[facts.role];
  const source = inherited ? `${rung}, inherited` : rung;

  const values: Record<string, string | number | null> = {
    font: face.role ?? face.slot,
    size: Math.round(resolved.fontSize * 100) / 100,
    weight: WEIGHT_TOKEN[resolved.fontWeight] ?? null,
    leading: Math.round(resolved.lineHeight * 1000) / 1000,
    tracking: resolved.letterSpacing,
  };

  // What a child inherits is what the ancestor *renders at*, which is the rung
  // only until the ancestor overrides it. Reporting the rung here would put a
  // muted "18" under text set at 72 — technically the theme's answer, and
  // useless.
  if (inherited) {
    const { overrides } = facts;
    const size = fontArgToPx(strip(overrides.size, "text-"));
    if (size !== null) values.size = size;
    const weight = strip(overrides.weight, "font-");
    if (weight !== undefined) values.weight = weight;
    const family = strip(overrides.family, "font-");
    if (family !== undefined) values.font = family;
    const leading = leadingToRatio(strip(overrides.leading, "leading-"));
    if (leading !== null) values.leading = Math.round(leading * 1000) / 1000;
  }

  const notes: Record<string, string> = {};
  for (const cls of facts.responsive) {
    const bare = cls.slice(cls.indexOf(":") + 1);
    const hit = RESPONSIVE_CONTROL.find(([prefix]) => bare.startsWith(prefix));
    if (hit) notes[hit[1]] = `${cls} also applies at wider frames`;
  }

  return { values, source, notes };
}

function strip(cls: string | undefined, prefix: string): string | undefined {
  return cls?.startsWith(prefix) ? cls.slice(prefix.length) : undefined;
}

/**
 * The node's own rung, or the closest ancestor's. Resolving each ancestor
 * against its *own* path matters: the typeset region a rung renders under is
 * decided by where it sits, not by where the walk started.
 */
function nearestRung(
  theme: Theme,
  tree: Node,
  path: number[],
  node: Node,
): { facts: NonNullable<ReturnType<typeof nodeTypography>>; inherited: boolean } | null {
  const own = nodeTypography(theme, tree, path, node);
  if (own) return { facts: own, inherited: false };
  for (let depth = path.length - 1; depth >= 0; depth--) {
    const ancestorPath = path.slice(0, depth);
    const ancestor = nodeAt(tree, ancestorPath);
    if (!ancestor) break;
    const facts = nodeTypography(theme, tree, ancestorPath, ancestor);
    if (facts) return { facts, inherited: true };
  }
  return null;
}

function nodeAt(tree: Node, path: readonly number[]): Node | null {
  let node: Node | undefined = tree;
  for (const index of path) {
    if (!node || !("$ref" in node)) return null;
    node = node.children?.[index];
  }
  return node ?? null;
}
