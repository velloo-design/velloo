import { type ComponentNode, isComponentNode, type Node, type Theme } from "@velloo/schema";
import {
  DEFAULT_TYPESET_NAME,
  HEADING_ROLE_BY_LEVEL,
  type ResolvedTypesetRole,
  resolveHeadingLevel,
  TEXT_ROLE_BY_VARIANT,
  type TextVariant,
  TYPESET_RATIOS,
  TYPESET_SCALE_NAMES,
  type Typeset,
  type TypesetRole,
  typesetScale,
} from "@velloo/schema/typeset";

/**
 * What the theme says a text node is set in, and what on the node overrules it.
 *
 * The inspector could only ever show a node's raw props, which for typography is
 * the least useful half of the story: `level: 2` says nothing about what h2
 * means in this folder, and a `text-4xl` sitting next to it silently wins over
 * the ladder. Resolving both sides here is what lets the panel say "h2, which
 * this theme sets at 32px — except your className overrides it to 36px".
 */

/** Which property a utility class on the node takes over from the ladder. */
export type OverriddenProperty = "size" | "leading" | "tracking" | "weight" | "family";

export interface NodeTypography {
  /** Rung of the theme's ladder this node lands on. */
  role: TypesetRole;
  /** The prop that chose the rung, phrased for display — `level 2`, `variant muted`. */
  via: string;
  /** The rung resolved against the typeset in effect. */
  resolved: ResolvedTypesetRole;
  /** Font role the rung paints with, and the stack behind it. */
  face: { slot: "heading" | "body"; role?: string; stack?: string };
  /** Base-width utilities on the node that beat the ladder. */
  overrides: Partial<Record<OverriddenProperty, string>>;
  /** Variant-prefixed typography utilities (`md:text-7xl`), which apply conditionally. */
  responsive: string[];
  /**
   * The typeset region the node sits in: a named preset from an ancestor, or
   * null for the folder baseline on `:root`.
   */
  region: { name: string; via: "prose" | "class" } | null;
}

/**
 * The rung a node renders at, as a short suffix for a label — `h2` for a
 * Heading, absent for anything whose type name already says everything.
 *
 * A tree of four "Heading" rows is unreadable when the thing that distinguishes
 * them is the level, and `level` is buried in the prop list. Text variants are
 * left out: `body` next to "Text" would be noise on the common case.
 */
export function nodeRung(node: Node): string | null {
  if (!("$ref" in node) || node.$ref !== "Heading") return null;
  return HEADING_ROLE_BY_LEVEL[resolveHeadingLevel(node.props?.level)] ?? null;
}

/** Tailwind's own size scale, plus the ladder's roles — everything `text-*` can mean as a size. */
const TEXT_SIZE_TOKENS = new Set<string>([
  "xs",
  "sm",
  "base",
  "lg",
  "xl",
  "2xl",
  "3xl",
  "4xl",
  "5xl",
  "6xl",
  "7xl",
  "8xl",
  "9xl",
  ...TYPESET_SCALE_NAMES,
]);

const WEIGHT_TOKENS = new Set([
  "thin",
  "extralight",
  "light",
  "normal",
  "medium",
  "semibold",
  "bold",
  "extrabold",
  "black",
]);

/** A length-ish arbitrary value, so `text-[15px]` reads as a size and `text-[#fff]` doesn't. */
const LENGTH_VALUE = /^\[-?[\d.]+(px|rem|em|%|ch|vw|vh)?\]$/;

/**
 * Which property a single utility class takes over, or null if it isn't a
 * typography utility at all.
 *
 * `text-` and `font-` are both overloaded, and getting them wrong is worse than
 * saying nothing: `text-cream/75` is a colour, not a size, and `font-light` is a
 * weight while `font-display` is a family. Families are matched against the
 * theme's declared roles rather than guessed, which is the only way to tell
 * `font-display` from a weight keyword we don't know about.
 */
export function overriddenProperty(
  cls: string,
  fontRoles: ReadonlySet<string>,
): OverriddenProperty | null {
  if (cls.startsWith("leading-")) return "leading";
  if (cls.startsWith("tracking-")) return "tracking";
  if (cls.startsWith("text-")) {
    const value = cls.slice(5);
    return TEXT_SIZE_TOKENS.has(value) || LENGTH_VALUE.test(value) ? "size" : null;
  }
  if (cls.startsWith("font-")) {
    const value = cls.slice(5);
    if (WEIGHT_TOKENS.has(value)) return "weight";
    if (fontRoles.has(value)) return "family";
    // Stock generic families, which no theme declares as a role.
    if (value === "sans" || value === "serif" || value === "mono") return "family";
    return null;
  }
  return null;
}

/** The rung a node lands on, or null when the node isn't a typography component. */
function rungOf(node: ComponentNode): { role: TypesetRole; via: string } | null {
  const props = node.props ?? {};
  if (node.$ref === "Heading") {
    const level = resolveHeadingLevel(props.level);
    return {
      role: HEADING_ROLE_BY_LEVEL[level] as TypesetRole,
      // Say when the level is the default rather than authored: a Heading with
      // no level prop renders an h1, and the prop list shows an empty dropdown.
      via: props.level === undefined ? "level 1 (default)" : `level ${level}`,
    };
  }
  if (node.$ref === "Text") {
    const raw = String(props.variant ?? "default");
    const variant = (raw in TEXT_ROLE_BY_VARIANT ? raw : "default") as TextVariant;
    return {
      role: TEXT_ROLE_BY_VARIANT[variant],
      via: props.variant === undefined ? "variant default" : `variant ${variant}`,
    };
  }
  return null;
}

/** The node and every ancestor above it, nearest first. */
function ancestorChain(tree: Node, path: readonly number[]): Node[] {
  const chain: Node[] = [tree];
  let node: Node | undefined = tree;
  for (const index of path) {
    if (!node || !("$ref" in node)) break;
    node = node.children?.[index];
    if (!node) break;
    chain.push(node);
  }
  return chain.reverse();
}

/**
 * The typeset region a node renders inside.
 *
 * Deliberately an ancestor walk rather than a node property, because that is
 * what a typeset is: `Prose` (or a bare `typeset-<name>` class) puts the preset
 * on a wrapper and every descendant re-derives the ladder from it. Asking "which
 * preset does this node use" only has an answer relative to its ancestry.
 */
export function typesetRegion(
  tree: Node,
  path: readonly number[],
): { name: string; via: "prose" | "class" } | null {
  for (const node of ancestorChain(tree, path)) {
    if (!("$ref" in node)) continue;
    const className = typeof node.props?.className === "string" ? node.props.className : "";
    const preset = className.split(/\s+/).find((c) => c.startsWith("typeset-"));
    if (preset) return { name: preset.slice("typeset-".length), via: "class" };
    if (node.$ref === "Prose") {
      const authored = node.props?.preset;
      return {
        name: typeof authored === "string" && authored ? authored : DEFAULT_TYPESET_NAME,
        via: "prose",
      };
    }
    if (className.split(/\s+/).includes("typeset")) {
      return { name: DEFAULT_TYPESET_NAME, via: "class" };
    }
  }
  return null;
}

/**
 * Resolve everything the Typography readout shows, or null when the selected
 * node has no place on the ladder.
 */
export function nodeTypography(
  theme: Theme,
  tree: Node,
  path: readonly number[],
  node: Node,
): NodeTypography | null {
  if (!isComponentNode(node)) return null;
  const rung = rungOf(node);
  if (!rung) return null;

  const typesets = theme.typography.typesets ?? {};
  const region = typesetRegion(tree, path);
  const baseline: Typeset = typesets[DEFAULT_TYPESET_NAME] ?? {};
  // A preset authors only what it changes and inherits the rest, so the
  // effective typeset is the preset over the baseline — the same composition
  // the emitted CSS performs through variable substitution.
  const preset = region && region.name !== DEFAULT_TYPESET_NAME ? typesets[region.name] : undefined;
  const effective: Typeset = { ...baseline, ...(preset ?? {}) };

  const fontFamily = theme.typography.fontFamily ?? {};
  const resolved = typesetScale(effective, { fontFamily })[rung.role];
  const slot = TYPESET_RATIOS[rung.role].face;
  const faceRole =
    slot === "heading" ? (effective.fontHeading ?? effective.fontBody) : effective.fontBody;

  const fontRoles = new Set(Object.keys(fontFamily));
  const className = typeof node.props?.className === "string" ? node.props.className : "";
  const overrides: Partial<Record<OverriddenProperty, string>> = {};
  const responsive: string[] = [];
  for (const cls of className.split(/\s+/).filter(Boolean)) {
    const colon = cls.lastIndexOf(":");
    const bare = colon === -1 ? cls : cls.slice(colon + 1);
    const property = overriddenProperty(bare, fontRoles);
    if (!property) continue;
    // A variant-prefixed utility only applies at some widths or states, so it
    // can't be reported as "what this renders at" — but staying silent about it
    // would make the readout wrong at every other breakpoint.
    if (colon === -1) overrides[property] ??= cls;
    else responsive.push(cls);
  }

  return {
    role: rung.role,
    via: rung.via,
    resolved,
    face: {
      slot,
      ...(faceRole ? { role: faceRole } : {}),
      ...(faceRole && fontFamily[faceRole] ? { stack: fontFamily[faceRole] } : {}),
    },
    overrides,
    responsive,
    region,
  };
}
