/**
 * Generic box-side resolution + collapse, shared by the `sx` and inline-`style`
 * adapters (and mirrored by the Tailwind one). A shorthand (`p`, `padding`) sets
 * all four sides; an axis (`px`, `paddingInline`) sets a pair; a side wins over
 * both. Collapse goes the other way, emitting the fewest keys.
 */

export interface Sides<V> {
  top?: V;
  right?: V;
  bottom?: V;
  left?: V;
}

export type SpacingVariant = "all" | "x" | "y" | "top" | "right" | "bottom" | "left";

/** Apply a value to the side(s) a variant covers. */
export function applySide<V>(sides: Sides<V>, variant: SpacingVariant, val: V): void {
  switch (variant) {
    case "all":
      sides.top = sides.right = sides.bottom = sides.left = val;
      break;
    case "x":
      sides.left = sides.right = val;
      break;
    case "y":
      sides.top = sides.bottom = val;
      break;
    default:
      sides[variant] = val;
  }
}

/** Least-specific first, so longhands win regardless of source order. */
export function rankVariant(v: SpacingVariant): number {
  if (v === "all") return 0;
  if (v === "x" || v === "y") return 1;
  return 2;
}

/** Collapse sides into the fewest variants: `{all}`, `{x,y}`, or per-side. */
export function collapseSides<V>(sides: Sides<V>): Partial<Record<SpacingVariant, V>> {
  const { top, right, bottom, left } = sides;
  const out: Partial<Record<SpacingVariant, V>> = {};
  if (top === undefined && right === undefined && bottom === undefined && left === undefined)
    return out;
  if (top !== undefined && top === right && right === bottom && bottom === left) {
    out.all = top;
    return out;
  }
  if (top !== undefined && top === bottom) out.y = top;
  else {
    if (top !== undefined) out.top = top;
    if (bottom !== undefined) out.bottom = bottom;
  }
  if (left !== undefined && left === right) out.x = left;
  else {
    if (left !== undefined) out.left = left;
    if (right !== undefined) out.right = right;
  }
  return out;
}
