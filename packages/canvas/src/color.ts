import { type Color, converter, formatCss, formatHex, formatHsl, parse } from "culori";

const toOklch = converter("oklch");
const toRgb = converter("rgb");
const toHsl = converter("hsl");

export interface ColorTriplet {
  hex: string;
  oklch: string;
  hsl: string;
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
  const oklch = toOklch(c);
  const hsl = toHsl(c);
  return {
    hex: formatHex(rgb) ?? "#000000",
    oklch: formatCss(oklch) ?? "",
    hsl: formatHsl(hsl) ?? "",
  };
}

/** Always produce an OKLCH string for storage. */
export function normalizeToOklch(input: string): string | null {
  const c = parse(input);
  if (!c) return null;
  return formatCss(toOklch(c)) ?? null;
}
