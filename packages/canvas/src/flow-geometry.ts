/**
 * Pure geometry for the arrows between a board's frames. No store, no DOM —
 * the same contract as board-geometry.ts, so a read-only viewer can import
 * this file by path and draw a board's flow exactly as the canvas does.
 *
 * Everything is in board coordinates. Nothing here knows the zoom: the layer
 * that draws these keeps strokes and labels a constant size on screen with the
 * board's `--canvas-zoom` variable, so a route is computed once per layout
 * change and never per wheel tick.
 */

export interface FlowBox {
  x: number;
  y: number;
  w: number;
  h: number;
  /**
   * Board px above the box that the frame's header row occupies. An arrow
   * that meets the frame from above stops clear of it, so its head doesn't
   * land on the frame's name. The caller derives it from the zoom (the header
   * holds a constant size on screen); the geometry only subtracts it.
   */
  head?: number;
}

interface FlowPoint {
  x: number;
  y: number;
}

type FlowSide = "left" | "right" | "top" | "bottom";

export interface FlowRoute {
  /** SVG path data: one cubic from `start` to `end`. */
  d: string;
  start: FlowPoint;
  end: FlowPoint;
  /** Where the label sits: the curve's midpoint. */
  mid: FlowPoint;
  /** Direction the arrow travels as it arrives, in degrees (0 = rightwards). */
  angle: number;
  /** Whether it runs side to side ("x") or top to bottom ("y"). */
  axis: "x" | "y";
  /**
   * Which side of the centre line it was moved to make room for an arrow the
   * other way: -1 up or left, 1 down or right, 0 when it has the line to itself.
   */
  lane: -1 | 0 | 1;
}

/** Outward normal of each side — the direction a curve leaves or enters by. */
const NORMAL: Record<FlowSide, FlowPoint> = {
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  top: { x: 0, y: -1 },
  bottom: { x: 0, y: 1 },
};

/** Direction of travel on arriving at each side, in degrees (0 = rightwards). */
const ARRIVAL: Record<FlowSide, number> = { left: 0, top: 90, right: 180, bottom: -90 };

/**
 * How far a pair of opposite arrows (A → B and B → A) sit apart on the side
 * they share, in board px. Without it the two curves are the same curve.
 */
const TWIN_GAP = 14;

/** Shortest and longest a curve's control handle is allowed to be. */
const MIN_HANDLE = 32;
const MAX_HANDLE = 220;

function anchor(box: FlowBox, side: FlowSide, shift: number): FlowPoint {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  // The shift slides along the side, clamped so it can't leave the frame.
  const along = (centre: number, start: number, length: number) =>
    Math.max(start, Math.min(start + length, centre + shift));
  switch (side) {
    case "left":
      return { x: box.x, y: along(cy, box.y, box.h) };
    case "right":
      return { x: box.x + box.w, y: along(cy, box.y, box.h) };
    case "top":
      return { x: along(cx, box.x, box.w), y: box.y - (box.head ?? 0) };
    case "bottom":
      return { x: along(cx, box.x, box.w), y: box.y + box.h };
  }
}

/**
 * Which side the arrow leaves `from` by and which it enters `to` by. Frames
 * that clear each other horizontally connect side to side, the reading
 * direction of a flow laid out in a row; ones stacked in a column connect
 * bottom to top. Overlapping frames fall back to whichever axis separates
 * their centres more, so there is always an answer.
 */
function sides(from: FlowBox, to: FlowBox): [FlowSide, FlowSide] {
  if (from.x + from.w <= to.x) return ["right", "left"];
  if (to.x + to.w <= from.x) return ["left", "right"];
  if (from.y + from.h <= to.y) return ["bottom", "top"];
  if (to.y + to.h <= from.y) return ["top", "bottom"];
  const dx = to.x + to.w / 2 - (from.x + from.w / 2);
  const dy = to.y + to.h / 2 - (from.y + from.h / 2);
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? ["right", "left"] : ["left", "right"];
  return dy >= 0 ? ["bottom", "top"] : ["top", "bottom"];
}

const round = (n: number) => Math.round(n * 10) / 10;

/**
 * The curve from one frame to another. `twin` says an arrow runs the other way
 * between the same two frames; each then shifts to its own side of the centre
 * line — by direction of travel, so the pair always part the same way.
 */
export function routeFlowEdge(from: FlowBox, to: FlowBox, twin = false): FlowRoute {
  const [leave, enter] = sides(from, to);
  const forward = leave === "right" || leave === "bottom";
  const lane = twin ? (forward ? -1 : 1) : 0;
  const start = anchor(from, leave, lane * TWIN_GAP);
  const end = anchor(to, enter, lane * TWIN_GAP);
  return { ...curve(start, leave, end, enter), lane };
}

/**
 * The curve from a frame to a loose point — the arrow being dragged out of a
 * frame before it has somewhere to land.
 */
export function routeFlowDraft(from: FlowBox, to: FlowPoint): FlowRoute {
  const [leave, enter] = sides(from, { x: to.x, y: to.y, w: 0, h: 0 });
  return curve(anchor(from, leave, 0), leave, to, enter);
}

function curve(start: FlowPoint, leave: FlowSide, end: FlowPoint, enter: FlowSide): FlowRoute {
  const out = NORMAL[leave];
  const into = NORMAL[enter];
  const reach = Math.hypot(end.x - start.x, end.y - start.y);
  const handle = Math.max(MIN_HANDLE, Math.min(MAX_HANDLE, reach * 0.4));
  const c1 = { x: start.x + out.x * handle, y: start.y + out.y * handle };
  const c2 = { x: end.x + into.x * handle, y: end.y + into.y * handle };
  return {
    d: `M ${round(start.x)} ${round(start.y)} C ${round(c1.x)} ${round(c1.y)}, ${round(c2.x)} ${round(c2.y)}, ${round(end.x)} ${round(end.y)}`,
    start,
    end,
    // A cubic at t = 0.5.
    mid: {
      x: round((start.x + 3 * c1.x + 3 * c2.x + end.x) / 8),
      y: round((start.y + 3 * c1.y + 3 * c2.y + end.y) / 8),
    },
    angle: ARRIVAL[enter],
    axis: leave === "left" || leave === "right" ? "x" : "y",
    lane: 0,
  };
}

/**
 * The frame under a board-space point, or null. Later frames paint over
 * earlier ones, so the last match is the one the pointer is visibly on.
 * `reach` widens every box by that many board px — a drop just outside a
 * frame's edge still means that frame.
 */
export function flowFrameAt(
  boxes: ReadonlyArray<FlowBox & { id: string }>,
  point: FlowPoint,
  reach = 0,
): string | null {
  for (let index = boxes.length - 1; index >= 0; index--) {
    const box = boxes[index] as FlowBox & { id: string };
    if (
      point.x >= box.x - reach &&
      point.x <= box.x + box.w + reach &&
      point.y >= box.y - reach &&
      point.y <= box.y + box.h + reach
    ) {
      return box.id;
    }
  }
  return null;
}
