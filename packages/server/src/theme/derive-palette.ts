import { err, ok, type Result } from "@velloo/result";
import type { Colors, Theme } from "@velloo/schema";
import { converter, parse, wcagContrast } from "culori";
import { invalidColor, type ThemeError } from "./errors.ts";

const toOklch = converter("oklch");

interface Oklch {
  mode: "oklch";
  l: number;
  c: number;
  h?: number | undefined;
  alpha?: number | undefined;
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

function parseOklch(input: string): Result<Oklch, ThemeError> {
  const parsed = parse(input);
  if (!parsed) {
    return err(
      invalidColor(
        `Could not parse color: ${JSON.stringify(input)}`,
        "Accepts #rrggbb, named colors, rgb(), hsl(), oklch(), etc.",
      ),
    );
  }
  const o = toOklch(parsed);
  return ok({ mode: "oklch", l: o.l ?? 0.5, c: o.c ?? 0, h: o.h, alpha: o.alpha });
}

/** Internal: assume parsed; safe to use after the seed already validated. */
function parseOklchOrZero(input: string): Oklch {
  const parsed = parse(input);
  if (!parsed) return { mode: "oklch", l: 0.5, c: 0 };
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

  const fgOk = parseOklchOrZero(fg);
  const bgOk = parseOklchOrZero(bg);
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
export function derivePalette(
  seedColor: string,
  current: Theme,
  name?: string,
): Result<DeriveResult, ThemeError> {
  const seedR = parseOklch(seedColor);
  if (!seedR.ok) return seedR;
  const seed = seedR.value;
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

  // Dark palette from the SAME seed: a brightened primary on a faintly
  // seed-tinted near-black, neutrals carrying a whisper of the hue. Without
  // this, deriving a new brand color left dark mode on the previous
  // palette — a brand-color mismatch and silent dark-contrast failures.
  const darkFg = "oklch(0.985 0 0)";
  const darkPrimary = withL(seed, 0.72);
  const darkPrimaryFg = ensureContrast("oklch(0.16 0 0)", darkPrimary);
  if (darkPrimaryFg.adjusted) {
    adjustments.push({
      slot: "dark:primary.foreground",
      from: "oklch(0.16 0 0)",
      to: darkPrimaryFg.color,
    });
  }
  const darkAccent = lowChroma(seed, 0.3, 0.6);
  const darkAccentFg = ensureContrast(darkFg, darkAccent);
  if (darkAccentFg.adjusted) {
    adjustments.push({ slot: "dark:accent.foreground", from: darkFg, to: darkAccentFg.color });
  }
  const darkDestructive = "oklch(0.62 0.21 25)";
  const darkDestructiveFg = ensureContrast(darkFg, darkDestructive);
  const colorsDark: Colors = {
    background: lowChroma(seed, 0.16, 0.3),
    foreground: darkFg,
    primary: { DEFAULT: darkPrimary, foreground: darkPrimaryFg.color },
    secondary: { DEFAULT: lowChroma(seed, 0.27, 0.35), foreground: darkFg },
    muted: { DEFAULT: lowChroma(seed, 0.27, 0.35), foreground: "oklch(0.708 0 0)" },
    accent: { DEFAULT: darkAccent, foreground: darkAccentFg.color },
    destructive: { DEFAULT: darkDestructive, foreground: darkDestructiveFg.color },
    card: { DEFAULT: lowChroma(seed, 0.205, 0.3), foreground: darkFg },
    popover: { DEFAULT: lowChroma(seed, 0.205, 0.3), foreground: darkFg },
    border: "oklch(1 0 0 / 0.1)",
    input: "oklch(1 0 0 / 0.15)",
    ring: darkPrimary,
  };

  return ok({
    theme: { ...current, name: name ?? current.name, colors, colorsDark },
    adjustments,
  });
}
