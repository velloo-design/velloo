/**
 * Reading and writing a HUD control's value against a node.
 *
 * Every value carries an {@link Origin}: whether it comes from the theme, was
 * changed on this element, or has no theme opinion at all. That distinction is
 * the point of the HUD — the number in the field is meaningless unless you can
 * see where it came from and whether touching it is a local override.
 *
 * Style values round-trip through the Tailwind class model, so anything the
 * controls don't model (variants, unknown utilities) survives untouched.
 */

import type { Node } from "@velloo/schema";
import { isComponentNode, isSnippetInstance } from "@velloo/schema";
import {
  argToPx,
  type BoxSides,
  type ParsedClasses,
  parseClasses,
  pxToArg,
  serializeClasses,
  type TwModel,
} from "../style-editor/tailwind-classes.ts";
import type { ControlSpec, StyleKey } from "./control-set.ts";

/**
 * Where a displayed value came from.
 *
 * - `theme` — the node says nothing; this is what the theme style resolves to.
 * - `changed` — the node overrides the theme.
 * - `plain` — no theme opinion exists for this slot (spacing, size), so there
 *   is nothing to fall back to and pretending otherwise would be a lie.
 */
export type Origin = "theme" | "changed" | "plain";

export interface ControlValue {
  /** Display value: px number, ratio, token name, or choice value. */
  readonly value: string | number | boolean | null;
  readonly origin: Origin;
  /**
   * Whether the node itself carries this value. False means whatever the field
   * shows is a default someone else decided — the theme, or the browser — so
   * the widget renders it muted rather than passing it off as an edit.
   */
  readonly authored: boolean;
  /** What the theme says, when the node overrides it — shown as "was 32". */
  readonly themeValue?: string | number | null;
  /**
   * What the slot resolves to when nobody named it — the browser's 16px, the
   * component's own padding. Shown greyed in place of a dash, so an untouched
   * field still answers "what size is this".
   */
  readonly computed?: string | number | null;
  /** The theme style the value is inherited from, e.g. "Heading 1". */
  readonly source?: string | undefined;
}

// ------------------------------------------------------------- font sizing

/** Tailwind's default type scale, in px. */
const FONT_PX: Record<string, number> = {
  xs: 12,
  sm: 14,
  base: 16,
  lg: 18,
  xl: 20,
  "2xl": 24,
  "3xl": 30,
  "4xl": 36,
  "5xl": 48,
  "6xl": 60,
  "7xl": 72,
  "8xl": 96,
  "9xl": 128,
};
const PX_TO_FONT: Record<number, string> = Object.fromEntries(
  Object.entries(FONT_PX).map(([step, px]) => [px, step]),
);

export function fontArgToPx(arg: string | undefined): number | null {
  if (arg === undefined) return null;
  const named = FONT_PX[arg];
  if (named !== undefined) return named;
  const m = /^\[(\d*\.?\d+)px\]$/.exec(arg);
  return m ? Number(m[1]) : null;
}

export function pxToFontArg(px: number): string {
  return PX_TO_FONT[px] ?? `[${px}px]`;
}

/** Named line-height utilities → their ratio. */
const LEADING_RATIO: Record<string, number> = {
  none: 1,
  tight: 1.25,
  snug: 1.375,
  normal: 1.5,
  relaxed: 1.625,
  loose: 2,
};

export function leadingToRatio(arg: string | undefined): number | null {
  if (arg === undefined) return null;
  const named = LEADING_RATIO[arg];
  if (named !== undefined) return named;
  const bracketed = /^\[(\d*\.?\d+)\]$/.exec(arg);
  if (bracketed) return Number(bracketed[1]);
  // `leading-6` is 1.5rem, which only becomes a ratio against a font size.
  return null;
}

export function ratioToLeading(ratio: number): string {
  for (const [name, value] of Object.entries(LEADING_RATIO)) {
    if (Math.abs(value - ratio) < 0.001) return name;
  }
  return `[${Number(ratio.toFixed(3))}]`;
}

// --------------------------------------------------------------- box sides

/** The single value all four sides share, or null when they differ. */
export function uniformSide(sides: BoxSides): string | null {
  const { top, right, bottom, left } = sides;
  if (top === undefined || top !== right || top !== bottom || top !== left) return null;
  return top;
}

function setAllSides(value: string | undefined): BoxSides {
  return value === undefined ? {} : { top: value, right: value, bottom: value, left: value };
}

// ------------------------------------------------------------ size choices

/**
 * `Fill` / `Hug` / `Fixed` — the outcome names. Anything that isn't one of the
 * two keywords is a fixed measurement, whatever unit it's written in.
 */
export function sizeChoiceOf(arg: string | undefined): "full" | "fit" | "fixed" | null {
  if (arg === undefined) return null;
  if (arg === "full" || arg === "screen") return "full";
  if (arg === "fit" || arg === "auto" || arg === "min" || arg === "max") return "fit";
  return "fixed";
}

/** The px behind a `Fixed` size, when it's expressible. */
export function sizeFixedPx(arg: string | undefined): number | null {
  if (arg === undefined) return null;
  const bracketed = /^\[(\d*\.?\d+)px\]$/.exec(arg);
  if (bracketed) return Number(bracketed[1]);
  return argToPx(arg);
}

// ------------------------------------------------------------ read / write

export function classNameOf(node: Node): string {
  if (isSnippetInstance(node)) return node.$extraClassName ?? "";
  if (!isComponentNode(node)) return "";
  return typeof node.props?.className === "string" ? node.props.className : "";
}

/** Raw slot value from the style model, normalised to the control's units. */
function readStyleSlot(model: TwModel, key: StyleKey): string | number | null {
  switch (key) {
    // Spacing controls are in px both ways; the model stores Tailwind args.
    case "padding":
      return argToPx(uniformSide(model.padding) ?? undefined);
    case "margin":
      return argToPx(uniformSide(model.margin) ?? undefined);
    case "gap":
      return argToPx(model.gap);
    case "fontSize":
      return fontArgToPx(model.fontSize);
    case "leading":
      return leadingToRatio(model.leading);
    // A bare `border` is 1px with an empty argument; the control says "1".
    case "borderWidth":
      return model.borderWidth === "" ? "1" : (model.borderWidth ?? null);
    default:
      return model[key] ?? null;
  }
}

/** Apply a control's new value to the style model, in place of a mutation. */
function writeStyleSlot(model: TwModel, key: StyleKey, value: string | number | null): TwModel {
  const next: TwModel = { ...model, padding: { ...model.padding }, margin: { ...model.margin } };
  if (value === null) {
    switch (key) {
      case "padding":
        next.padding = {};
        break;
      case "margin":
        next.margin = {};
        break;
      default:
        next[key] = undefined;
    }
    return next;
  }
  switch (key) {
    case "padding":
      next.padding = setAllSides(pxToArg(Number(value)));
      break;
    case "margin":
      next.margin = setAllSides(pxToArg(Number(value)));
      break;
    case "gap":
      next.gap = pxToArg(Number(value));
      break;
    case "fontSize":
      next.fontSize = pxToFontArg(Number(value));
      break;
    case "leading":
      next.leading = ratioToLeading(Number(value));
      break;
    case "borderWidth":
      next.borderWidth = String(value) === "1" ? "" : String(value);
      break;
    default:
      next[key] = String(value);
  }
  return next;
}

export interface ReadContext {
  readonly node: Node;
  /**
   * What the theme resolves to for this node, keyed by control id — supplied by
   * the caller because resolving a typeset rung needs the screen root, not just
   * the node.
   */
  readonly themeValues?: Readonly<Record<string, string | number | null>>;
  /** The theme style in effect, e.g. "Heading 1". */
  readonly themeSource?: string | undefined;
  /** Resolved CSS keyed by control id — see `computedValues`. */
  readonly computed?: Readonly<Record<string, string | number>> | undefined;
}

/** Slots the theme has an opinion about — everything else reads as `plain`. */
const THEMED_SLOTS = new Set<StyleKey>([
  "fontFamily",
  "fontSize",
  "fontWeight",
  "leading",
  "tracking",
  "textColor",
  "bg",
  "borderColor",
  "rounded",
]);

/** The value and provenance the HUD should show for one control. */
export function readControl(spec: ControlSpec, ctx: ReadContext): ControlValue {
  const { node, themeValues, themeSource } = ctx;
  const computed = ctx.computed?.[spec.id] ?? null;

  if (spec.slot.via === "arg") {
    const args = isSnippetInstance(node) ? node.args : undefined;
    const value = normaliseScalar(args?.[spec.slot.name]);
    return { value, origin: "plain", authored: value !== null };
  }

  if (spec.slot.via === "prop") {
    const props = isComponentNode(node) ? node.props : undefined;
    const value = normaliseScalar(props?.[spec.slot.name]);
    return { value, origin: "plain", authored: value !== null };
  }

  const key = spec.slot.key;
  const { model } = parseClasses(classNameOf(node));
  const own = readStyleSlot(model, key);
  const themed = themeValues?.[spec.id] ?? null;

  if (own !== null) {
    // The node says something. It's an override only when the theme also has an
    // opinion and the two disagree.
    if (themed !== null && themed !== own) {
      return {
        value: own,
        origin: "changed",
        authored: true,
        themeValue: themed,
        source: themeSource,
      };
    }
    return {
      value: own,
      origin: themed !== null ? "theme" : "plain",
      authored: true,
      ...(themed !== null && themeSource !== undefined ? { source: themeSource } : {}),
    };
  }

  if (themed !== null) {
    return { value: themed, origin: "theme", authored: false, source: themeSource };
  }
  // Nobody named this slot. The field still answers "what is it" — the
  // resolved value rides the same greyed channel a theme value would.
  return {
    value: null,
    origin: THEMED_SLOTS.has(key) ? "theme" : "plain",
    authored: false,
    computed,
  };
}

function normaliseScalar(raw: unknown): string | number | boolean | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") return raw;
  return null;
}

/**
 * The class string after applying a control's new value. `null` clears the slot,
 * which is how "revert to the theme" works — remove the override and the theme
 * shows through again.
 */
export function applyStyleValue(
  className: string,
  key: StyleKey,
  value: string | number | null,
): string {
  const parsed: ParsedClasses = parseClasses(className);
  return serializeClasses({ model: writeStyleSlot(parsed.model, key, value), extra: parsed.extra });
}

/** HTML tags a `Box` can wear that lay out as inline-level runs. */
const INLINE_TAGS = new Set([
  "span",
  "a",
  "em",
  "strong",
  "b",
  "i",
  "u",
  "s",
  "small",
  "code",
  "kbd",
  "samp",
  "var",
  "abbr",
  "cite",
  "mark",
  "q",
  "sub",
  "sup",
  "time",
  "label",
]);

/**
 * Align, made to bite on an inline run.
 *
 * `text-align` is a property of a block container, so `text-center` on a
 * `<span>` moves nothing — the control was there, it wrote the class, and the
 * canvas looked identical. Aligning a text run is a real intent, so give it the
 * box it needs: an inline node with no display of its own becomes `block`,
 * which is what it would have to be for the alignment to mean anything. A node
 * that already declares a display is left alone — that display was a choice.
 */
export function blockifyForAlign(className: string, node: Node): string {
  if (!isComponentNode(node)) return className;
  const as = typeof node.props?.as === "string" ? node.props.as : undefined;
  if (as === undefined || !INLINE_TAGS.has(as)) return className;
  const parsed: ParsedClasses = parseClasses(className);
  if (parsed.model.display !== undefined && parsed.model.display !== "inline") return className;
  return serializeClasses({ model: { ...parsed.model, display: "block" }, extra: parsed.extra });
}
