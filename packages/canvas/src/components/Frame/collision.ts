/**
 * Pure frame-collision geometry for board interactions. Everything works on
 * "occupied" rects — the frame's schema rect plus the vertical chrome around
 * the iframe (header above, preset chips below) — so "touching" means
 * visually adjacent, not header-over-content.
 *
 * Philosophy (matches the original clamp): the frame being manipulated is the
 * only one that yields. Resizing shrinks the draft against neighbors; moving
 * nudges the dragged frame out of a neighbor; neighbors are never displaced,
 * so a gesture can't rearrange frames the user didn't touch.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const MIN_FRAME_SIDE = 120;

const overlaps = (a: Rect, b: Rect): boolean =>
  b.x < a.x + a.w && b.x + b.w > a.x && b.y < a.y + a.h && b.y + b.h > a.y;

/**
 * Clamp a resize so the frame may grow until it actually touches a neighbor —
 * no pre-emptive gutter, and no arbitrary axis choice: a diagonal neighbor
 * clamps whichever axis preserves more of the requested area, so an east-only
 * drag is never blocked by a frame that's really *below*. Neighbors that
 * already overlap the start rect are ignored (a resize can't heal a
 * pre-existing overlap, and clamping against one would junk the gesture).
 * The clamp never shrinks below the gesture's start size.
 */
export function clampResizeToNeighbors(
  start: Rect,
  neighbors: readonly Rect[],
  nextW: number,
  nextH: number,
): { w: number; h: number } {
  let cw = nextW;
  let ch = nextH;
  const resolvable = neighbors.filter((n) => !overlaps(start, n));
  for (let pass = 0; pass <= resolvable.length; pass++) {
    const hit = resolvable.find((n) => overlaps({ x: start.x, y: start.y, w: cw, h: ch }, n));
    if (!hit) break;
    const wLimit = hit.x - start.x;
    const hLimit = hit.y - start.y;
    // A clamp only counts when the neighbor sits beyond the start edge —
    // otherwise it would drag the frame below its gesture-start size.
    const canW = wLimit >= start.w;
    const canH = hLimit >= start.h;
    if (canW && (!canH || wLimit * ch >= cw * hLimit)) cw = wLimit;
    else if (canH) ch = hLimit;
    else break;
  }
  return { w: cw, h: ch };
}

/**
 * Resolve a move so the frame lands adjacent to — never over — a neighbor.
 * The dragged frame is pushed out along the axis of least penetration
 * (snap-adjacent, flush edges), deterministically: ties resolve in
 * left/right/up/down order. One push can land it on another neighbor, so it
 * iterates; a genuinely unresolvable pocket falls back to `fallback` (the
 * gesture's start position, which was overlap-free).
 */
export function resolveMoveCollision(
  size: { w: number; h: number },
  neighbors: readonly Rect[],
  next: { x: number; y: number },
  fallback: { x: number; y: number },
): { x: number; y: number } {
  let px = next.x;
  let py = next.y;
  for (let pass = 0; pass <= neighbors.length; pass++) {
    const hit = neighbors.find((n) => overlaps({ x: px, y: py, w: size.w, h: size.h }, n));
    if (!hit) return { x: px, y: py };
    const pushes = [
      { dx: hit.x - size.w - px, dy: 0 },
      { dx: hit.x + hit.w - px, dy: 0 },
      { dx: 0, dy: hit.y - size.h - py },
      { dx: 0, dy: hit.y + hit.h - py },
    ];
    const best = pushes.reduce((a, b) =>
      Math.abs(b.dx) + Math.abs(b.dy) < Math.abs(a.dx) + Math.abs(a.dy) ? b : a,
    );
    px += best.dx;
    py += best.dy;
  }
  return fallback;
}
