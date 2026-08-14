/**
 * WCAG 2.1 contrast scoring for theme color pairs. Designs need to know
 * before they ship whether `primary` against `primary-foreground` clears
 * AA — eyeballing OKLCH is unreliable.
 *
 * The audited pairs are the ones agents actually compose: text on every
 * surface, focused borders, accent overlays. Each result carries a
 * `score` (numeric ratio), a `tier` (AAA / AA / AAlarge / Fail), and the
 * raw input strings so the canvas can show "primary/foreground 5.4:1 AA".
 */

import type { Theme } from "@velloo/schema";
import { type Color, formatHex, parse as parseCulori } from "culori";

export type ContrastTier = "AAA" | "AA" | "AAlarge" | "Fail";

export interface ContrastResult {
  /** e.g. "primary / primary-foreground" */
  label: string;
  fg: string;
  bg: string;
  ratio: number;
  tier: ContrastTier;
}

/**
 * Relative luminance per the WCAG 2.1 spec (sRGB linearization, then
 * weighted by 0.2126/0.7152/0.0722).
 */
function srgbChannel(c: number): number {
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(rgb: { r: number; g: number; b: number }): number {
  const r = srgbChannel(rgb.r);
  const g = srgbChannel(rgb.g);
  const b = srgbChannel(rgb.b);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function parseToRgb(color: string): { r: number; g: number; b: number } | null {
  const parsed = parseCulori(color) as Color | undefined;
  if (!parsed) return null;
  // formatHex normalizes to sRGB; re-parse for 0-1 channels.
  const hex = formatHex(parsed);
  if (!hex) return null;
  const stripped = hex.replace(/^#/, "");
  if (stripped.length !== 6) return null;
  const r = Number.parseInt(stripped.slice(0, 2), 16) / 255;
  const g = Number.parseInt(stripped.slice(2, 4), 16) / 255;
  const b = Number.parseInt(stripped.slice(4, 6), 16) / 255;
  return { r, g, b };
}

export function contrastRatio(fg: string, bg: string): number | null {
  const fgRgb = parseToRgb(fg);
  const bgRgb = parseToRgb(bg);
  if (!fgRgb || !bgRgb) return null;
  const l1 = relativeLuminance(fgRgb);
  const l2 = relativeLuminance(bgRgb);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

export function tierForRatio(ratio: number): ContrastTier {
  if (ratio >= 7) return "AAA";
  if (ratio >= 4.5) return "AA";
  if (ratio >= 3) return "AAlarge";
  return "Fail";
}

type Pair = { label: string; fg: string | undefined; bg: string | undefined };

function colorValue(slot: unknown): string | undefined {
  if (typeof slot === "string") return slot;
  if (slot && typeof slot === "object" && "DEFAULT" in slot) {
    const def = (slot as { DEFAULT?: unknown }).DEFAULT;
    return typeof def === "string" ? def : undefined;
  }
  return undefined;
}

function fgValue(slot: unknown): string | undefined {
  if (slot && typeof slot === "object" && "foreground" in slot) {
    const fg = (slot as { foreground?: unknown }).foreground;
    return typeof fg === "string" ? fg : undefined;
  }
  return undefined;
}

/**
 * Score every salient color pair in a theme. Pairs that can't be parsed
 * (missing or malformed values) are skipped silently — the canvas should
 * treat the audit as opportunistic, not exhaustive.
 */
export function scoreThemeContrast(theme: Theme): ContrastResult[] {
  const c = theme.colors;
  const pairs: Pair[] = [
    { label: "foreground on background", fg: c.foreground as string, bg: c.background as string },
    {
      label: "primary-foreground on primary",
      fg: fgValue(c.primary),
      bg: colorValue(c.primary),
    },
    {
      label: "secondary-foreground on secondary",
      fg: fgValue(c.secondary),
      bg: colorValue(c.secondary),
    },
    { label: "accent-foreground on accent", fg: fgValue(c.accent), bg: colorValue(c.accent) },
    { label: "muted-foreground on muted", fg: fgValue(c.muted), bg: colorValue(c.muted) },
    { label: "card-foreground on card", fg: fgValue(c.card), bg: colorValue(c.card) },
    {
      label: "destructive-foreground on destructive",
      fg: fgValue(c.destructive),
      bg: colorValue(c.destructive),
    },
    { label: "foreground on card", fg: c.foreground as string, bg: colorValue(c.card) },
    { label: "muted-foreground on background", fg: fgValue(c.muted), bg: c.background as string },
  ];

  const out: ContrastResult[] = [];
  for (const p of pairs) {
    if (!p.fg || !p.bg) continue;
    const ratio = contrastRatio(p.fg, p.bg);
    if (ratio === null) continue;
    out.push({
      label: p.label,
      fg: p.fg,
      bg: p.bg,
      ratio: Math.round(ratio * 100) / 100,
      tier: tierForRatio(ratio),
    });
  }
  return out;
}
