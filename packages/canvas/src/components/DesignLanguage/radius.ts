/** Corner radius as the theme stores it (`radius.md`) ⇄ the pixels a slider speaks. */

const REM_PX = 16;

/** Null for a value this control can't represent — a `calc()`, a percentage. */
export function radiusToPx(value: string | number | undefined): number | null {
  if (typeof value === "number") return value;
  if (value === undefined) return null;
  const match = /^(-?\d*\.?\d+)(px|rem)?$/.exec(value.trim());
  if (!match) return null;
  const n = Number(match[1]);
  return match[2] === "rem" ? n * REM_PX : n;
}

/** Stored in rem, the unit an imported stylesheet's `--radius` is nearly always in. */
export function pxToRadius(px: number): string {
  return `${Number((px / REM_PX).toFixed(4))}rem`;
}

export const RADIUS_PRESETS: ReadonlyArray<{ px: number; label: string }> = [
  { px: 0, label: "Sharp" },
  { px: 4, label: "Subtle" },
  { px: 8, label: "Soft" },
  { px: 12, label: "Round" },
  { px: 20, label: "Pill" },
];

export function radiusLabel(px: number): string {
  return RADIUS_PRESETS.find((p) => p.px === px)?.label ?? "Custom";
}
