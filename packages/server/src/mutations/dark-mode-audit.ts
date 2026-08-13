import { $, DoAsync, type Result } from "@velloo/result";
import { isComponentNode, isSnippetInstance, type Node } from "@velloo/schema";
import type { MutationContext } from "./context.ts";
import type { MutationError } from "./errors.ts";
import { getPage, getVariant } from "./lookup.ts";

export interface DarkModeAuditArgs {
  pageId: string;
  variantId: string;
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
  /** 0..1 — fraction of color-touching nodes that use semantic tokens. */
  coverage: number;
  /** Nodes with at least one non-semantic color class. */
  problems: DarkModeAuditNode[];
  /** Total nodes that touch color at all (denominator for coverage). */
  totalColored: number;
}

/**
 * The Tailwind palette families that don't theme-flip. If you see any of
 * these, the class renders identically under .dark — i.e. it makes your
 * dark-mode block useless for that node.
 */
const RAW_PALETTE_FAMILIES = [
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
];

/** Color-touching utility prefixes. Anything starting with these is "color-relevant". */
const COLOR_PREFIXES = [
  "bg-",
  "text-",
  "border-",
  "ring-",
  "outline-",
  "divide-",
  "from-",
  "via-",
  "to-",
  "fill-",
  "stroke-",
  "shadow-", // shadow-zinc-500/20 etc.
  "decoration-",
  "accent-",
  "caret-",
  "placeholder-",
];

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

/** Hardcoded that don't theme: white/black/transparent/current/inherit/none. */
const FIXED_LITERALS = new Set(["white", "black", "transparent", "current", "inherit", "none"]);

interface ParsedColorClass {
  raw: string;
  /** Utility prefix without trailing dash: "bg", "text", "border", ... */
  prefix: string;
  /** Family name or literal: "zinc", "emerald", "white", "primary", ... */
  family: string;
}

const VARIANT_RE = /^([^:]+:)+/;
const SUFFIX_RE = /\/[0-9]+$/; // opacity suffix

function stripDecorations(cls: string): { core: string; variantPrefix: string } {
  const m = cls.match(VARIANT_RE);
  const variantPrefix = m ? m[0] : "";
  const withoutVariants = cls.slice(variantPrefix.length);
  const withoutOpacity = withoutVariants.replace(SUFFIX_RE, "");
  return { core: withoutOpacity, variantPrefix };
}

function parseColorClass(cls: string): ParsedColorClass | null {
  const { core } = stripDecorations(cls);
  for (const p of COLOR_PREFIXES) {
    if (!core.startsWith(p)) continue;
    const rest = core.slice(p.length);
    // Arbitrary values like bg-[#fa00ff] — count as raw since they won't theme.
    if (rest.startsWith("[") && rest.endsWith("]")) {
      return { raw: cls, prefix: p.slice(0, -1), family: "arbitrary" };
    }
    // bg-zinc-500 → family=zinc; bg-white → family=white; bg-primary → family=primary
    const firstSeg = rest.split("-")[0] ?? rest;
    return { raw: cls, prefix: p.slice(0, -1), family: firstSeg };
  }
  return null;
}

function isSemantic(parsed: ParsedColorClass): boolean {
  // bg-primary, text-primary-foreground, etc. — anything where the family
  // matches a known semantic token name.
  if (SEMANTIC_NAMES.has(parsed.family)) return true;
  // bg-primary-foreground (two-segment) — also semantic. We only kept the
  // first segment in parseColorClass; check the full core too.
  const { core } = stripDecorations(parsed.raw);
  const rest = core.slice(parsed.prefix.length + 1);
  if (SEMANTIC_NAMES.has(rest)) return true;
  return false;
}

function isRawPalette(parsed: ParsedColorClass): boolean {
  if (RAW_PALETTE_FAMILIES.includes(parsed.family)) return true;
  if (FIXED_LITERALS.has(parsed.family)) return true;
  if (parsed.family === "arbitrary") return true;
  return false;
}

/**
 * Suggest a semantic-token replacement when an obvious one exists. Heuristic
 * mapping; not all raw classes have a clean semantic equivalent (e.g.
 * `text-emerald-400` for an intentional accent has no theme counterpart).
 */
function suggestSemanticFor(parsed: ParsedColorClass): string | null {
  const { variantPrefix } = stripDecorations(parsed.raw);
  const { prefix, family } = parsed;
  // Background fills: light cards → bg-card, deep neutrals → bg-background.
  if (prefix === "bg") {
    if (
      family === "white" ||
      (RAW_PALETTE_FAMILIES.includes(family) && parsed.raw.endsWith("-50"))
    ) {
      return `${variantPrefix}bg-card`;
    }
    if (
      family === "black" ||
      (RAW_PALETTE_FAMILIES.includes(family) && /-95\d?$/.test(parsed.raw))
    ) {
      return `${variantPrefix}bg-background`;
    }
    if (RAW_PALETTE_FAMILIES.includes(family) && /-(900|800|700)$/.test(parsed.raw)) {
      return `${variantPrefix}bg-muted`;
    }
  }
  if (prefix === "text") {
    if (
      family === "black" ||
      (RAW_PALETTE_FAMILIES.includes(family) && /-(900|800)$/.test(parsed.raw))
    ) {
      return `${variantPrefix}text-foreground`;
    }
    if (
      family === "white" ||
      (RAW_PALETTE_FAMILIES.includes(family) && /-(50|100)$/.test(parsed.raw))
    ) {
      return `${variantPrefix}text-foreground`;
    }
    if (RAW_PALETTE_FAMILIES.includes(family) && /-(400|500|600)$/.test(parsed.raw)) {
      return `${variantPrefix}text-muted-foreground`;
    }
  }
  if (prefix === "border" || prefix === "divide") {
    if (RAW_PALETTE_FAMILIES.includes(family)) return `${variantPrefix}${prefix}-border`;
  }
  if (prefix === "ring") {
    if (RAW_PALETTE_FAMILIES.includes(family)) return `${variantPrefix}ring-ring`;
  }
  return null;
}

function auditClasses(className: string): {
  raw: string[];
  suggestions: Record<string, string>;
  hasColor: boolean;
  allSemantic: boolean;
} {
  const tokens = className.split(/\s+/).filter(Boolean);
  const raw: string[] = [];
  const suggestions: Record<string, string> = {};
  let hasColor = false;
  let allSemantic = true;
  for (const token of tokens) {
    const parsed = parseColorClass(token);
    if (!parsed) continue;
    hasColor = true;
    if (isSemantic(parsed)) continue;
    if (isRawPalette(parsed)) {
      raw.push(token);
      allSemantic = false;
      const suggestion = suggestSemanticFor(parsed);
      if (suggestion) suggestions[token] = suggestion;
    } else {
      // Unknown family — be conservative, treat as raw.
      raw.push(token);
      allSemantic = false;
    }
  }
  return { raw, suggestions, hasColor, allSemantic };
}

/**
 * Walk a variant tree and report nodes whose className uses raw palette
 * colors that won't theme-flip. Snippet instances are checked at the
 * instance level (their resolved body is opaque from this audit's POV —
 * audit the snippet body separately if needed).
 */
export async function darkModeAudit(
  ctx: MutationContext,
  args: DarkModeAuditArgs,
): Promise<Result<DarkModeAuditResult, MutationError>> {
  return DoAsync<DarkModeAuditResult, MutationError>(async function* () {
    const page = yield* $(getPage(ctx, args.pageId));
    const variant = yield* $(getVariant(page, args.pageId, args.variantId));

    const problems: DarkModeAuditNode[] = [];
    let totalColored = 0;
    let semanticCount = 0;

    function walk(node: Node, path: number[]): void {
      if (isComponentNode(node)) {
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
        for (let i = 0; i < (node.children?.length ?? 0); i++) {
          const child = node.children?.[i];
          if (child) walk(child, [...path, i]);
        }
      } else if (isSnippetInstance(node)) {
        // Snippet instances are opaque — audit the snippet's body separately.
        // Don't descend.
      }
    }
    walk(variant.tree, []);

    const coverage = totalColored === 0 ? 1 : semanticCount / totalColored;
    return { coverage, problems, totalColored };
  });
}
