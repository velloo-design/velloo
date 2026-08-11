import { type Color, converter, formatHex, parse } from "culori";

const toOklch = converter("oklch");
const toRgb = converter("rgb");
const toHsl = converter("hsl");

export interface ColorTriplet {
  hex: string;
  oklch: string;
  hsl: string;
}

/** Round to 3 decimals (and trim trailing zeros). Keeps OKLCH strings readable. */
function r(n: number | undefined, precision = 3): number {
  if (n === undefined || Number.isNaN(n)) return 0;
  const p = 10 ** precision;
  return Math.round(n * p) / p;
}

function formatOklchRounded(c: Color): string {
  // culori's formatCss emits long fractional digits; we re-build the OKLCH
  // string ourselves with rounded components.
  const o = toOklch(c);
  const l = r(o.l);
  const ch = r(o.c);
  const h = r(o.h);
  const a = o.alpha !== undefined && o.alpha < 1 ? ` / ${r(o.alpha, 3)}` : "";
  return `oklch(${l} ${ch} ${h}${a})`;
}

function formatHslRounded(c: Color): string {
  const h = toHsl(c);
  const hue = r(h.h ?? 0, 1);
  const s = r((h.s ?? 0) * 100, 1);
  const l = r((h.l ?? 0) * 100, 1);
  const a = h.alpha !== undefined && h.alpha < 1 ? ` / ${r(h.alpha, 3)}` : "";
  return `hsl(${hue} ${s}% ${l}%${a})`;
}

/** Best-effort parse → triplet. Returns null if the input isn't a recognized color. */
export function parseTriplet(input: string): ColorTriplet | null {
  if (!input) return null;
  const c = parse(input);
  if (!c) return null;
  return formatTriplet(c);
}

function formatTriplet(c: Color): ColorTriplet {
  const rgb = toRgb(c);
  return {
    hex: formatHex(rgb) ?? "#000000",
    oklch: formatOklchRounded(c),
    hsl: formatHslRounded(c),
  };
}

/** Always produce a rounded OKLCH string for storage. */
export function normalizeToOklch(input: string): string | null {
  const c = parse(input);
  if (!c) return null;
  return formatOklchRounded(c);
}
