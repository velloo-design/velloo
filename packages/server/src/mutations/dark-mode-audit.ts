import { $, DoAsync, type Result } from "@velloo/result";
import { isComponentNode, isSnippetInstance, type Node } from "@velloo/schema";
import type { MutationContext } from "./context.ts";
import type { MutationError } from "./errors.ts";
import { getScreen, getSnippet } from "./lookup.ts";

export interface DarkModeAuditArgs {
  screenId: string;
}

export interface DarkModeAuditNode {
  path: number[];
  ref: string;
  /** The full className string, for context. */
  className: string;
  /** Classes that won't flip under dark mode (raw palette colors, hardcoded white/black). */
  raw: string[];
  /** Suggested semantic-token replacements for each raw class, when an obvious one exists. */
  suggestions: Record<string, string>;
}

export interface DarkModeAuditResult {
  /** 0..1 — fraction of color-bearing nodes that use semantic tokens only. */
  coverage: number;
  /** Nodes with at least one non-semantic color class. */
  problems: DarkModeAuditNode[];
  /** Total nodes carrying at least one color-bearing class (denominator for coverage). */
  totalColored: number;
}

/**
 * The Tailwind palette families that don't theme-flip. A class using these
 * (with or without a shade) renders identically under .dark — i.e. it
 * makes your dark-mode block useless for that node.
 */
const RAW_PALETTE_FAMILIES = new Set([
  "slate",
  "gray",
  "zinc",
  "neutral",
  "stone",
  "red",
  "orange",
  "amber",
  "yellow",
  "lime",
  "green",
  "emerald",
  "teal",
  "cyan",
  "sky",
  "blue",
  "indigo",
  "violet",
  "purple",
  "fuchsia",
  "pink",
  "rose",
]);

/**
 * Semantic tokens that the velloo theme exposes. A class using these flips
 * correctly under .dark.
 */
const SEMANTIC_NAMES = new Set([
  "background",
  "foreground",
  "card",
  "card-foreground",
  "popover",
  "popover-foreground",
  "primary",
  "primary-foreground",
  "secondary",
  "secondary-foreground",
  "muted",
  "muted-foreground",
  "accent",
  "accent-foreground",
  "destructive",
  "destructive-foreground",
  "border",
  "input",
  "ring",
]);

/**
 * Hardcoded "color-literal" names. These DO touch color but they don't
 * theme — and that's normally intentional (e.g. `bg-transparent` on an
 * overlay, `text-current` to inherit). Don't flag them.
 */
const COLOR_NEUTRAL_LITERALS = new Set(["transparent", "current", "inherit"]);

/**
 * Hardcoded names that DO render a fixed color and won't theme-flip.
 * Flag these as raw.
 */
const FIXED_COLOR_LITERALS = new Set(["white", "black"]);

/**
 * Utility prefixes that *can* carry color. A prefix being on this list is
 * a necessary but NOT sufficient condition — the suffix after the prefix
 * has to actually denote a color (palette family, semantic name, color
 * literal, or arbitrary-color value).
 */
const COLOR_CAPABLE_PREFIXES = [
  "bg",
  "text",
  "border",
  "ring",
  "outline",
  "divide",
  "from",
  "via",
  "to",
  "fill",
  "stroke",
  "shadow",
  "decoration",
  "accent",
  "caret",
  "placeholder",
];

const VARIANT_RE = /^([^:]+:)+/;
const OPACITY_SUFFIX_RE = /\/[0-9]+$/;

interface ParsedColorClass {
  raw: string;
  variantPrefix: string;
  prefix: string;
  /** Family/name: "zinc", "primary", "white", "transparent", or "arbitrary". */
  family: string;
  /** True when the family is a known palette name (with optional shade). */
  isPalette: boolean;
  /** True when the family is a semantic token. */
  isSemantic: boolean;
  /** True when the family is a color literal (white/black/transparent/current). */
  isLiteral: boolean;
  /** True when the value is an arbitrary `[...]` that contains a color-ish token. */
  isArbitraryColor: boolean;
}

function stripDecorations(cls: string): { core: string; variantPrefix: string } {
  const m = cls.match(VARIANT_RE);
  const variantPrefix = m ? m[0] : "";
  const withoutVariants = cls.slice(variantPrefix.length);
  const withoutOpacity = withoutVariants.replace(OPACITY_SUFFIX_RE, "");
  return { core: withoutOpacity, variantPrefix };
}

/**
 * Detect a color shape inside an arbitrary value like `bg-[#fa00ff]`,
 * `border-[rgb(...)]`, `text-[oklch(...)]`. Treats anything else (e.g.
 * `grid-cols-[80px_1fr]` — which wouldn't hit this code anyway since
 * `grid-cols` isn't in COLOR_CAPABLE_PREFIXES) as non-color.
 */
function looksLikeArbitraryColor(value: string): boolean {
  return (
    /^#[0-9a-fA-F]{3,8}$/.test(value) ||
    /^(rgb|rgba|hsl|hsla|oklch|oklab|lab|lch|color)\(/i.test(value)
  );
}

/**
 * Parse a single class. Returns null if the class is structural / non-color
 * (e.g. `border-b`, `ring-0`, `shadow-md`, `text-5xl`, `flex`, `p-6`).
 * Returns a `ParsedColorClass` describing the color form otherwise.
 *
 * The classifier walks the prefix-capable list (so `border-b` doesn't get
 * mis-classified just because `border-` is a prefix). For each capable
 * prefix we examine the suffix after the dash and decide whether it
 * denotes a color.
 */
function parseColorClass(cls: string): ParsedColorClass | null {
  const { core, variantPrefix } = stripDecorations(cls);

  for (const prefix of COLOR_CAPABLE_PREFIXES) {
    const head = `${prefix}-`;
    if (!core.startsWith(head)) continue;
    const rest = core.slice(head.length);
    if (rest.length === 0) continue;

    // Arbitrary value: bg-[#fa00ff], bg-[rgb(...)], bg-[oklch(...)].
    if (rest.startsWith("[") && rest.endsWith("]")) {
      const inner = rest.slice(1, -1);
      if (!looksLikeArbitraryColor(inner)) return null;
      return {
        raw: cls,
        variantPrefix,
        prefix,
        family: "arbitrary",
        isPalette: false,
        isSemantic: false,
        isLiteral: false,
        isArbitraryColor: true,
      };
    }

    const firstSeg = rest.split("-")[0] ?? rest;

    // Color-neutral literals (transparent / current / inherit): touch color
    // but are intentionally non-flipping. Treat as "not a color problem".
    if (COLOR_NEUTRAL_LITERALS.has(rest) || COLOR_NEUTRAL_LITERALS.has(firstSeg)) return null;

    if (FIXED_COLOR_LITERALS.has(rest) || FIXED_COLOR_LITERALS.has(firstSeg)) {
      return {
        raw: cls,
        variantPrefix,
        prefix,
        family: firstSeg,
        isPalette: false,
        isSemantic: false,
        isLiteral: true,
        isArbitraryColor: false,
      };
    }

    if (RAW_PALETTE_FAMILIES.has(firstSeg)) {
      return {
        raw: cls,
        variantPrefix,
        prefix,
        family: firstSeg,
        isPalette: true,
        isSemantic: false,
        isLiteral: false,
        isArbitraryColor: false,
      };
    }

    // Semantic token check needs to consider multi-segment names like
    // `primary-foreground`. The core after the prefix is the full token.
    if (SEMANTIC_NAMES.has(rest)) {
      return {
        raw: cls,
        variantPrefix,
        prefix,
        family: rest,
        isPalette: false,
        isSemantic: true,
        isLiteral: false,
        isArbitraryColor: false,
      };
    }
    if (SEMANTIC_NAMES.has(firstSeg)) {
      return {
        raw: cls,
        variantPrefix,
        prefix,
        family: firstSeg,
        isPalette: false,
        isSemantic: true,
        isLiteral: false,
        isArbitraryColor: false,
      };
    }

    // The prefix is color-capable but the suffix isn't a color word —
    // e.g. `border-b`, `border-0`, `border-dashed`, `ring-0`, `ring-inset`,
    // `shadow-none`, `shadow-md`, `text-5xl`, `text-center`. Structural.
    return null;
  }

  return null;
}

/**
 * Suggest a semantic-token replacement when an obvious one exists. Heuristic
 * mapping; not all raw classes have a clean semantic equivalent (e.g.
 * `text-emerald-400` for an intentional accent has no theme counterpart).
 */
function suggestSemanticFor(parsed: ParsedColorClass): string | null {
  if (!parsed.isPalette && !parsed.isLiteral) return null;
  const { variantPrefix, prefix, family, raw } = parsed;
  if (prefix === "bg") {
    if (family === "white" || (parsed.isPalette && raw.endsWith("-50"))) {
      return `${variantPrefix}bg-card`;
    }
    if (family === "black" || (parsed.isPalette && /-95\d?$/.test(raw))) {
      return `${variantPrefix}bg-background`;
    }
    if (parsed.isPalette && /-(900|800|700)$/.test(raw)) {
      return `${variantPrefix}bg-muted`;
    }
  }
  if (prefix === "text") {
    if (family === "black" || (parsed.isPalette && /-(900|800)$/.test(raw))) {
      return `${variantPrefix}text-foreground`;
    }
    if (family === "white" || (parsed.isPalette && /-(50|100)$/.test(raw))) {
      return `${variantPrefix}text-foreground`;
    }
    if (parsed.isPalette && /-(400|500|600)$/.test(raw)) {
      return `${variantPrefix}text-muted-foreground`;
    }
  }
  if ((prefix === "border" || prefix === "divide") && parsed.isPalette) {
    return `${variantPrefix}${prefix}-border`;
  }
  if (prefix === "ring" && parsed.isPalette) {
    return `${variantPrefix}ring-ring`;
  }
  return null;
}

interface AuditNodeOutcome {
  raw: string[];
  suggestions: Record<string, string>;
  hasColor: boolean;
  allSemantic: boolean;
}

function auditClasses(className: string): AuditNodeOutcome {
  const tokens = className.split(/\s+/).filter(Boolean);
  const raw: string[] = [];
  const suggestions: Record<string, string> = {};
  let hasColor = false;
  let allSemantic = true;
  for (const token of tokens) {
    const parsed = parseColorClass(token);
    if (!parsed) continue; // structural / non-color — ignored
    hasColor = true;
    if (parsed.isSemantic) continue;
    // isPalette, isLiteral (white/black), or isArbitraryColor → raw.
    raw.push(token);
    allSemantic = false;
    const suggestion = suggestSemanticFor(parsed);
    if (suggestion) suggestions[token] = suggestion;
  }
  return { raw, suggestions, hasColor, allSemantic };
}

/**
 * Walk an arbitrary tree (variant root or snippet body) and produce the
 * audit result. Snippet instances inside the tree are NOT descended into
 * — those bodies have their own audit scope. Exported for callers that
 * hold a tree without a MutationContext (headless render tooling runs it over the
 * changed screens of a headless checkout).
 */
export function darkModeAuditTree(root: Node): DarkModeAuditResult {
  const problems: DarkModeAuditNode[] = [];
  let totalColored = 0;
  let semanticCount = 0;

  function walk(node: Node, path: number[]): void {
    if (isComponentNode(node)) {
      // `data-accent` (any truthy value) opts a node out of the audit
      // entirely. Use for intentional non-flipping accents: brand mark,
      // hero gradient, status pill chrome, dark-tuned overlays with
      // explicit `dark:` variants. The data attribute survives codegen
      // naturally so the opt-out is visible in the emitted HTML too.
      const accentProp = node.props?.["data-accent"];
      const isAccent =
        accentProp !== undefined &&
        accentProp !== null &&
        accentProp !== false &&
        accentProp !== "";
      if (!isAccent) {
        const className =
          typeof node.props?.className === "string" ? (node.props.className as string) : "";
        if (className) {
          const { raw, suggestions, hasColor, allSemantic } = auditClasses(className);
          if (hasColor) {
            totalColored++;
            if (allSemantic) semanticCount++;
            if (raw.length > 0) {
              problems.push({
                path: [...path],
                ref: node.$ref,
                className,
                raw,
                suggestions,
              });
            }
          }
        }
      }
      // Always descend, regardless of accent opt-out on this node — accent
      // status doesn't cascade to children. A wrapper marked
      // data-accent="brand" doesn't whitelist its inner text.
      for (let i = 0; i < (node.children?.length ?? 0); i++) {
        const child = node.children?.[i];
        if (child) walk(child, [...path, i]);
      }
    } else if (isSnippetInstance(node)) {
      // Snippet instances are opaque — audit the snippet's body separately
      // via audit_snippet. Don't descend here.
    }
  }
  walk(root, []);

  const coverage = totalColored === 0 ? 1 : semanticCount / totalColored;
  return { coverage, problems, totalColored };
}

/**
 * Walk a screen tree and report nodes whose className uses raw palette
 * colors that won't theme-flip. Snippet instances are opaque — audit the
 * snippet body separately with `auditSnippet`.
 */
export async function darkModeAudit(
  ctx: MutationContext,
  args: DarkModeAuditArgs,
): Promise<Result<DarkModeAuditResult, MutationError>> {
  return DoAsync<DarkModeAuditResult, MutationError>(async function* () {
    const screen = yield* $(getScreen(ctx, args.screenId));
    return darkModeAuditTree(screen.tree);
  });
}

export interface AuditSnippetArgs {
  snippetId: string;
}

/**
 * Run the dark-mode audit against a snippet's body. Catches bad raw-color
 * patterns at definition time, before the snippet is stamped into N pages.
 * Identical scoring rules and `data-accent` opt-out as the page-level
 * audit; paths are relative to the snippet body's root.
 *
 * `$param` placeholders inside the body are anonymous and have no
 * className — they're invisible to the audit by construction.
 */
export async function auditSnippet(
  ctx: MutationContext,
  args: AuditSnippetArgs,
): Promise<Result<DarkModeAuditResult, MutationError>> {
  return DoAsync<DarkModeAuditResult, MutationError>(async function* () {
    const snippet = yield* $(getSnippet(ctx, args.snippetId));
    return darkModeAuditTree(snippet.tree);
  });
}
