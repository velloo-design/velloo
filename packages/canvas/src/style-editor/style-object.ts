/**
 * Two-way bridge between a React inline-`style` object and the structured style
 * controls. Known camelCase properties project into {@link StyleModel}; the rest
 * stays in `extra` and shows in the synced "Declarations" list. A bare number is
 * px (React's rule); other units are strings.
 */
import { applySide, rankVariant, type Sides, type SpacingVariant } from "./spacing.ts";

export type CssVal = string | number;
export type CssSides = Sides<CssVal>;

export interface StyleModel {
  display?: CssVal | undefined;
  flexDirection?: CssVal | undefined;
  justifyContent?: CssVal | undefined;
  alignItems?: CssVal | undefined;
  gap?: CssVal | undefined;
  padding: CssSides;
  margin: CssSides;
  width?: CssVal | undefined;
  height?: CssVal | undefined;
  fontFamily?: CssVal | undefined;
  fontSize?: CssVal | undefined;
  fontWeight?: CssVal | undefined;
  lineHeight?: CssVal | undefined;
  letterSpacing?: CssVal | undefined;
  textAlign?: CssVal | undefined;
  color?: CssVal | undefined;
  backgroundColor?: CssVal | undefined;
  borderRadius?: CssVal | undefined;
}

export interface ParsedStyle {
  model: StyleModel;
  extra: Record<string, unknown>;
}

const SPACING_KEYS: Record<string, { box: "padding" | "margin"; v: SpacingVariant }> = {
  padding: { box: "padding", v: "all" },
  paddingTop: { box: "padding", v: "top" },
  paddingRight: { box: "padding", v: "right" },
  paddingBottom: { box: "padding", v: "bottom" },
  paddingLeft: { box: "padding", v: "left" },
  margin: { box: "margin", v: "all" },
  marginTop: { box: "margin", v: "top" },
  marginRight: { box: "margin", v: "right" },
  marginBottom: { box: "margin", v: "bottom" },
  marginLeft: { box: "margin", v: "left" },
};

const SCALAR_KEYS = [
  "display",
  "flexDirection",
  "justifyContent",
  "alignItems",
  "gap",
  "width",
  "height",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "lineHeight",
  "letterSpacing",
  "textAlign",
  "color",
  "backgroundColor",
  "borderRadius",
] as const;
const SCALAR_SET = new Set<string>(SCALAR_KEYS);

type ScalarKey = (typeof SCALAR_KEYS)[number];

function isScalarKey(k: string): k is ScalarKey {
  return SCALAR_SET.has(k);
}

/** A multi-value shorthand (`"16px 24px"`) we don't break into sides — keep raw. */
function isMultiValue(v: unknown): boolean {
  return typeof v === "string" && v.trim().includes(" ");
}

/** An inline-style length → px, or null. Bare numbers are px. */
export function cssToPx(v: CssVal | undefined): number | null {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const m = /^(-?\d*\.?\d+)px$/.exec(v.trim());
    if (m) return Number(m[1]);
  }
  return null;
}

export function parseStyle(obj: Record<string, unknown> | undefined): ParsedStyle {
  const model: StyleModel = { padding: {}, margin: {} };
  const extra: Record<string, unknown> = {};
  const spacing: Array<{ box: "padding" | "margin"; v: SpacingVariant; val: CssVal }> = [];

  for (const [k, val] of Object.entries(obj ?? {})) {
    const sp = SPACING_KEYS[k];
    // A `padding`/`margin` shorthand with multiple tokens stays raw.
    if (
      sp &&
      (typeof val === "number" || typeof val === "string") &&
      !(sp.v === "all" && isMultiValue(val))
    ) {
      spacing.push({ box: sp.box, v: sp.v, val });
      continue;
    }
    if (isScalarKey(k) && (typeof val === "number" || typeof val === "string")) {
      model[k] = val;
      continue;
    }
    extra[k] = val;
  }

  spacing.sort((a, b) => rankVariant(a.v) - rankVariant(b.v));
  for (const s of spacing) applySide(model[s.box], s.v, s.val);
  return { model, extra };
}

const CAP: Record<"top" | "right" | "bottom" | "left", string> = {
  top: "Top",
  right: "Right",
  bottom: "Bottom",
  left: "Left",
};

/** Emit `padding` when uniform, else per-side `paddingTop`… (CSS has no axis form). */
function emitSpacing(prefix: "padding" | "margin", sides: CssSides, out: Record<string, unknown>) {
  const { top, right, bottom, left } = sides;
  if (top === undefined && right === undefined && bottom === undefined && left === undefined)
    return;
  if (top !== undefined && top === right && right === bottom && bottom === left) {
    out[prefix] = top;
    return;
  }
  for (const side of ["top", "right", "bottom", "left"] as const) {
    const v = sides[side];
    if (v !== undefined) out[`${prefix}${CAP[side]}`] = v;
  }
}

export function serializeStyle({ model, extra }: ParsedStyle): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of SCALAR_KEYS) {
    const v = model[k];
    if (v !== undefined) out[k] = v;
  }
  emitSpacing("padding", model.padding, out);
  emitSpacing("margin", model.margin, out);
  Object.assign(out, extra);
  return out;
}
