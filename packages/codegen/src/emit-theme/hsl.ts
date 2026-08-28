import { converter, parse } from "culori";

const toRgb = converter("rgb");
const toHsl = converter("hsl");

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

/** Kill float noise at the gamut edge — an oklch white otherwise lands at r=1.0000001, g=0.9999998 and picks up a phantom hue. */
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

function pct(n: number): string {
  return `${Number((clamp01(n) * 100).toFixed(1))}%`;
}

/**
 * Convert any CSS color to the shadcn-v3 raw HSL triplet convention
 * (`222.2 47.4% 11.2%`), so the emitted v3 config can plumb Tailwind's
 * `<alpha-value>` through `hsl(var(--x) / <alpha-value>)` and opacity
 * modifiers (`bg-primary/50`) keep working. Out-of-sRGB oklch values clamp
 * to the gamut edge. Returns null for unparseable values and for colors
 * carrying their own alpha — a triplet with baked-in alpha would corrupt
 * the `<alpha-value>` slot, so those fall back to a raw `var()` mapping.
 */
export function hslTriplet(value: string): string | null {
  const parsed = parse(value.trim());
  if (!parsed) return null;
  if (parsed.alpha !== undefined && parsed.alpha < 1) return null;
  const rgb = toRgb(parsed);
  if (!rgb) return null;
  const hsl = toHsl({
    mode: "rgb" as const,
    r: clamp01(round4(rgb.r)),
    g: clamp01(round4(rgb.g)),
    b: clamp01(round4(rgb.b)),
  });
  if (!hsl) return null;
  let h = (((hsl.h ?? 0) % 360) + 360) % 360;
  let s = clamp01(hsl.s);
  const l = clamp01(hsl.l);
  // Hue (and saturation at the lightness poles) is meaningless for
  // achromatic colors — pin to 0 so grays emit stably.
  if (l <= 0.0001 || l >= 0.9999) s = 0;
  if (s <= 0.0001) h = 0;
  return `${Number(h.toFixed(1))} ${pct(s)} ${pct(l)}`;
}
