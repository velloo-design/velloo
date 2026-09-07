/**
 * Two-way bridge between a MUI `sx` object and the structured style controls.
 * Known keys project into {@link SxModel}; the controls don't touch anything
 * else (pseudo-selectors, `transition`, one-offs), which stays in `extra` and
 * surfaces as the "Additional sx" raw rows. Spacing shorthands (`p`, `px`, `pt`)
 * resolve to per-side values and collapse back on serialize.
 */
import {
  applySide,
  collapseSides,
  rankVariant,
  type Sides,
  type SpacingVariant,
} from "./spacing.ts";

export type SxVal = string | number;
type SxSides = Sides<SxVal>;

export interface SxModel {
  display?: SxVal | undefined;
  flexDirection?: SxVal | undefined;
  justifyContent?: SxVal | undefined;
  alignItems?: SxVal | undefined;
  gap?: SxVal | undefined;
  padding: SxSides;
  margin: SxSides;
  width?: SxVal | undefined;
  height?: SxVal | undefined;
  fontSize?: SxVal | undefined;
  fontWeight?: SxVal | undefined;
  lineHeight?: SxVal | undefined;
  letterSpacing?: SxVal | undefined;
  textAlign?: SxVal | undefined;
  typography?: SxVal | undefined;
  color?: SxVal | undefined;
  bgcolor?: SxVal | undefined;
  boxShadow?: SxVal | undefined;
  borderRadius?: SxVal | undefined;
  fontFamily?: SxVal | undefined;
}

export interface ParsedSx {
  model: SxModel;
  extra: Record<string, unknown>;
}

/** sx spacing keys (shorthand + longhand aliases) → which box + side(s). */
const SPACING_KEYS: Record<string, { box: "padding" | "margin"; v: SpacingVariant }> = {
  p: { box: "padding", v: "all" },
  padding: { box: "padding", v: "all" },
  px: { box: "padding", v: "x" },
  py: { box: "padding", v: "y" },
  pt: { box: "padding", v: "top" },
  paddingTop: { box: "padding", v: "top" },
  pr: { box: "padding", v: "right" },
  paddingRight: { box: "padding", v: "right" },
  pb: { box: "padding", v: "bottom" },
  paddingBottom: { box: "padding", v: "bottom" },
  pl: { box: "padding", v: "left" },
  paddingLeft: { box: "padding", v: "left" },
  m: { box: "margin", v: "all" },
  margin: { box: "margin", v: "all" },
  mx: { box: "margin", v: "x" },
  my: { box: "margin", v: "y" },
  mt: { box: "margin", v: "top" },
  marginTop: { box: "margin", v: "top" },
  mr: { box: "margin", v: "right" },
  marginRight: { box: "margin", v: "right" },
  mb: { box: "margin", v: "bottom" },
  marginBottom: { box: "margin", v: "bottom" },
  ml: { box: "margin", v: "left" },
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
  "fontSize",
  "fontWeight",
  "lineHeight",
  "letterSpacing",
  "textAlign",
  "typography",
  "color",
  "bgcolor",
  "boxShadow",
  "borderRadius",
  "fontFamily",
] as const;
const SCALAR_SET = new Set<string>(SCALAR_KEYS);

type ScalarKey = (typeof SCALAR_KEYS)[number];

function isScalarKey(k: string): k is ScalarKey {
  return SCALAR_SET.has(k);
}

/** MUI's default `theme.spacing` step (px). */
const SPACING_PX = 8;

/** An sx spacing value → px, or null if not pixel-resolvable. Numbers scale by 8. */
export function sxToPx(v: SxVal | undefined): number | null {
  if (typeof v === "number") return v * SPACING_PX;
  if (typeof v === "string") {
    const m = /^(-?\d*\.?\d+)px$/.exec(v.trim());
    if (m) return Number(m[1]);
  }
  return null;
}

/** px → an sx spacing value: a unitless scale step when it divides evenly, else a px string. */
export function pxToSx(px: number): SxVal {
  return px % SPACING_PX === 0 ? px / SPACING_PX : `${px}px`;
}

export function parseSx(obj: Record<string, unknown> | undefined): ParsedSx {
  const model: SxModel = { padding: {}, margin: {} };
  const extra: Record<string, unknown> = {};
  const spacing: Array<{ box: "padding" | "margin"; v: SpacingVariant; val: SxVal }> = [];

  for (const [k, val] of Object.entries(obj ?? {})) {
    const sp = SPACING_KEYS[k];
    if (sp && (typeof val === "string" || typeof val === "number")) {
      spacing.push({ box: sp.box, v: sp.v, val });
      continue;
    }
    if (isScalarKey(k) && (typeof val === "string" || typeof val === "number")) {
      model[k] = val;
      continue;
    }
    extra[k] = val;
  }

  spacing.sort((a, b) => rankVariant(a.v) - rankVariant(b.v));
  for (const s of spacing) applySide(model[s.box], s.v, s.val);
  return { model, extra };
}

/** Emit the shorthand spacing keys (`p`, `px`/`py`, `pt`…) for a box. */
function emitSpacing(prefix: "p" | "m", sides: SxSides, out: Record<string, unknown>) {
  const c = collapseSides(sides);
  const key: Record<SpacingVariant, string> = {
    all: prefix,
    x: `${prefix}x`,
    y: `${prefix}y`,
    top: `${prefix}t`,
    right: `${prefix}r`,
    bottom: `${prefix}b`,
    left: `${prefix}l`,
  };
  for (const [variant, val] of Object.entries(c)) {
    if (val !== undefined) out[key[variant as SpacingVariant]] = val;
  }
}

export function serializeSx({ model, extra }: ParsedSx): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of SCALAR_KEYS) {
    const v = model[k];
    if (v !== undefined) out[k] = v;
  }
  emitSpacing("p", model.padding, out);
  emitSpacing("m", model.margin, out);
  Object.assign(out, extra);
  return out;
}
