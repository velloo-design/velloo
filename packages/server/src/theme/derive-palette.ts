import type { Colors, Theme } from "@velloo/schema";
import { converter, parse, wcagContrast } from "culori";
import { ThemeError } from "./errors.ts";

const toOklch = converter("oklch");

interface Oklch {
  mode: "oklch";
  l: number;
  c: number;
  h?: number;
  alpha?: number;
}

function r(n: number | undefined, p = 3): number {
  if (n === undefined || Number.isNaN(n)) return 0;
  const k = 10 ** p;
  return Math.round(n * k) / k;
}

/** OKLCH string with components rounded to 3 decimals so theme JSON stays readable. */
function formatOklch(o: Oklch): string {
  const l = r(o.l);
  const c = r(o.c);
  const h = r(o.h);
  const a = o.alpha !== undefined && o.alpha < 1 ? ` / ${r(o.alpha)}` : "";
  return `oklch(${l} ${c} ${h}${a})`;
}

function parseOklch(input: string): Oklch {
  const parsed = parse(input);
  if (!parsed) {
    throw new ThemeError({
      code: "INVALID_COLOR",
      message: `Could not parse color: ${JSON.stringify(input)}`,
      hint: "Accepts #rrggbb, named colors, rgb(), hsl(), oklch(), etc.",
    });
  }
  const o = toOklch(parsed);
  return { mode: "oklch", l: o.l ?? 0.5, c: o.c ?? 0, h: o.h, alpha: o.alpha };
}

function withL(seed: Oklch, l: number): string {
  return formatOklch({ ...seed, l });
}

function lowChroma(seed: Oklch, l: number, factor = 0.05): string {
  return formatOklch({ ...seed, l, c: seed.c * factor });
}

/** Nudge `fg` toward white or black until contrast(fg, bg) ≥ minRatio. */
function ensureContrast(
  fg: string,
  bg: string,
  minRatio = 4.5,
): { color: string; adjusted: boolean } {
  const initial = wcagContrast(fg, bg);
  if (initial >= minRatio) return { color: fg, adjusted: false };

  const fgOk = parseOklch(fg);
  const bgOk = parseOklch(bg);
  // Decide direction by comparing lightness.
  const goingDark = fgOk.l <= bgOk.l;

  let current = fgOk;
  for (let step = 0; step < 20; step++) {
    current = {
      ...current,
      l: goingDark ? Math.max(0, current.l - 0.05) : Math.min(1, current.l + 0.05),
    };
    const next = formatOklch(current);
    if (wcagContrast(next, bg) >= minRatio) {
      return { color: next, adjusted: true };
    }
    if (current.l <= 0.02 || current.l >= 0.98) break;
  }
  // Last resort: pure black/white.
  return { color: goingDark ? "oklch(0 0 0)" : "oklch(1 0 0)", adjusted: true };
}

export interface DeriveResult {
  theme: Theme;
  adjustments: Array<{ slot: string; from: string; to: string }>;
}

/**
 * Generate a full color palette from a seed color. Lightness is varied per
 * slot; chroma is preserved on primary/accent and reduced on neutrals.
 * Foreground colors are checked against their pair's background and nudged
 * toward black/white if WCAG-AA (4.5) contrast would fail.
 */
export function derivePalette(seedColor: string, current: Theme, name?: string): DeriveResult {
  const seed = parseOklch(seedColor);
  const adjustments: DeriveResult["adjustments"] = [];

  const background = "oklch(1 0 0)";
  const foreground = "oklch(0.145 0 0)";

  // Primary uses the seed at a mid-lightness.
  const primaryDefault = withL(seed, 0.55);
  const rawPrimaryFg = "oklch(0.985 0 0)";
  const primaryFg = ensureContrast(rawPrimaryFg, primaryDefault);
  if (primaryFg.adjusted) {
    adjustments.push({ slot: "primary.foreground", from: rawPrimaryFg, to: primaryFg.color });
  }

  // Secondary / accent: low-chroma seed at high lightness.
  const secondaryDefault = lowChroma(seed, 0.95, 0.1);
  const secondaryFg = ensureContrast("oklch(0.2 0 0)", secondaryDefault);
  if (secondaryFg.adjusted) {
    adjustments.push({
      slot: "secondary.foreground",
      from: "oklch(0.2 0 0)",
      to: secondaryFg.color,
    });
  }

  const accentDefault = lowChroma(seed, 0.93, 0.18);
  const accentFg = ensureContrast("oklch(0.2 0 0)", accentDefault);
  if (accentFg.adjusted) {
    adjustments.push({ slot: "accent.foreground", from: "oklch(0.2 0 0)", to: accentFg.color });
  }

  // Muted / card / popover stay neutral, independent of seed.
  const colors: Colors = {
    background,
    foreground,
    primary: { DEFAULT: primaryDefault, foreground: primaryFg.color },
    secondary: { DEFAULT: secondaryDefault, foreground: secondaryFg.color },
    muted: { DEFAULT: "oklch(0.97 0 0)", foreground: "oklch(0.556 0 0)" },
    accent: { DEFAULT: accentDefault, foreground: accentFg.color },
    destructive: { DEFAULT: "oklch(0.577 0.245 27.325)", foreground: "oklch(0.985 0 0)" },
    card: { DEFAULT: "oklch(1 0 0)", foreground: "oklch(0.145 0 0)" },
    popover: { DEFAULT: "oklch(1 0 0)", foreground: "oklch(0.145 0 0)" },
    border: "oklch(0.922 0 0)",
    input: "oklch(0.922 0 0)",
    ring: lowChroma(seed, 0.708, 0.5),
  };

  return {
    theme: { ...current, name: name ?? current.name, colors },
    adjustments,
  };
}
