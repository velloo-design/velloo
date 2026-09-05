/**
 * What an unset slot actually resolves to, per HUD control.
 *
 * A field for a slot the node says nothing about used to read `—`, which is
 * true but useless: the question a designer is asking is "what size *is* this
 * heading", and the answer exists — the browser, the theme, or the component's
 * own classes decided it. The iframe reports `getComputedStyle` for the
 * selected node ({@link COMPUTED_PROPS}); this turns that into the vocabulary
 * each control speaks, so the number shown greyed is the real one.
 *
 * A slot whose computed value doesn't land on one of the control's named rungs
 * (a 3px border, a 6px radius) shows as the measurement itself. What never
 * happens is guessing it onto the nearest rung — a wrong default is worse than
 * a dash, and these are only ever displayed, never written.
 */

import { parseTriplet } from "../color.ts";

const px = (raw: string | undefined): number | null => {
  if (!raw) return null;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
};

/** CSS numeric weights → the choice values the Weight control offers. */
const WEIGHT_NAME: Record<string, string> = {
  "100": "light",
  "200": "light",
  "300": "light",
  "400": "normal",
  "500": "medium",
  "600": "semibold",
  "700": "bold",
  "800": "bold",
  "900": "bold",
};

/** Tailwind's border widths, the only ones the Border control can name. */
const BORDER_NAME: Record<number, string> = { 0: "0", 1: "1", 2: "2", 4: "4" };

/** A measurement no named scale covers, shown as itself rather than dropped. */
function asMeasure(value: number | null): string | null {
  return value === null ? null : `${value}px`;
}

/** `"Inter", ui-sans-serif, …` → `Inter`. */
function firstFamily(raw: string | undefined): string | null {
  const first = raw?.split(",")[0]?.trim();
  if (!first) return null;
  return first.replace(/^["']|["']$/g, "");
}

/**
 * A computed colour → `#rrggbb`, which a swatch can paint and a label can say.
 *
 * Chrome reports whatever colour space the value was authored in, and a Tailwind
 * v4 theme is authored in OKLCH — so this goes through culori rather than
 * matching `rgb()`, which silently dropped every themed colour.
 */
function hex(raw: string | undefined): string | null {
  if (!raw) return null;
  // Fully transparent is "no colour", not black.
  if (/^rgba?\([^)]*[,/]\s*0\s*\)$/.test(raw.trim())) return null;
  return parseTriplet(raw)?.hex ?? null;
}

/** The one value all four sides share, or null when they differ. */
function uniform(values: (number | null)[]): number | null {
  const [first] = values;
  if (first === null || first === undefined) return null;
  return values.every((v) => v === first) ? first : null;
}

/**
 * Resolved values keyed by control id — the same ids `readControl` reads, so a
 * control gets its default by lookup with no per-control wiring.
 */
export function computedValues(
  css: Readonly<Record<string, string>> | null | undefined,
): Readonly<Record<string, string | number>> {
  if (!css) return {};
  const out: Record<string, string | number> = {};
  const put = (id: string, value: string | number | null) => {
    if (value !== null) out[id] = value;
  };

  const fontSize = px(css.fontSize);
  put("font", firstFamily(css.fontFamily));
  put("size", fontSize);
  put("weight", WEIGHT_NAME[css.fontWeight ?? ""] ?? null);
  // Line height is a ratio in the HUD; `normal` has no number behind it.
  const lineHeight = px(css.lineHeight);
  put(
    "leading",
    lineHeight !== null && fontSize ? Math.round((lineHeight / fontSize) * 100) / 100 : null,
  );
  // The named scale only covers `normal`; anything else shows as itself.
  put("tracking", css.letterSpacing === "normal" ? "normal" : asMeasure(px(css.letterSpacing)));
  // CSS reports the writing-mode-relative keyword; the control says left/right.
  const align = css.textAlign === "start" ? "left" : css.textAlign === "end" ? "right" : null;
  put("align", align ?? css.textAlign ?? null);
  put("color", hex(css.color));
  put("bg", hex(css.backgroundColor));
  put("borderColor", hex(css.borderTopColor));
  const border = px(css.borderTopWidth);
  put("borderWidth", border === null ? null : (BORDER_NAME[border] ?? asMeasure(border)));
  // Corners are a named scale whose px depend on the theme, so the radius
  // shows as a measurement rather than being guessed onto a rung.
  put("rounded", asMeasure(px(css.borderTopLeftRadius)));
  put(
    "padding",
    uniform([px(css.paddingTop), px(css.paddingRight), px(css.paddingBottom), px(css.paddingLeft)]),
  );
  put(
    "margin",
    uniform([px(css.marginTop), px(css.marginRight), px(css.marginBottom), px(css.marginLeft)]),
  );
  // `column-gap: normal` on a non-flex box means no gap, not an unknown one.
  put("gap", css.columnGap === "normal" ? 0 : px(css.columnGap));
  return out;
}
