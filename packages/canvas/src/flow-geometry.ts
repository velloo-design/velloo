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
  /** The curve's two control points, for everything that walks along it. */
  c1: FlowPoint;
  c2: FlowPoint;
  /** The curve's midpoint. */
  mid: FlowPoint;
  /** Direction the arrow travels as it arrives, in degrees (0 = rightwards). */
  angle: number;
  /**
   * Which half of the side it leaves from, when it shares that side with
   * other arrows: -1 the upper or left half, 1 the lower or right, 0 the
   * middle. Its label goes on that side of it, away from its neighbours'.
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

/** Shortest and longest a curve's control handle is allowed to be. */
const MIN_HANDLE = 32;
const MAX_HANDLE = 220;

/** The point a fraction of the way along a side: 0.5 is its middle. */
function anchor(box: FlowBox, side: FlowSide, along: number): FlowPoint {
  switch (side) {
    case "left":
      return { x: box.x, y: box.y + box.h * along };
    case "right":
      return { x: box.x + box.w, y: box.y + box.h * along };
    case "top":
      return { x: box.x + box.w * along, y: box.y - (box.head ?? 0) };
    case "bottom":
      return { x: box.x + box.w * along, y: box.y + box.h };
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

/** The curve from one frame to another, on its own: middle of one side to middle of the other. */
export function routeFlowEdge(from: FlowBox, to: FlowBox): FlowRoute {
  const [leave, enter] = sides(from, to);
  return curve(anchor(from, leave, 0.5), leave, anchor(to, enter, 0.5), enter);
}

/**
 * The curves for all of a board's arrows, routed together so that no two
 * share a line. Arrows that meet the same side of a frame are spread evenly
 * along it — two take the thirds, three the quarters — instead of all leaving
 * from its middle: an arrow each way between two frames then runs as a pair of
 * parallel lines, and a long arrow that passes behind the frames in a row
 * comes out between them on a line of its own, not on top of the short arrows
 * that join those frames to each other.
 *
 * Along a side, arrows are placed in the order of where they lead, so two
 * arrows fanning out from one frame don't cross on their way; arrows to the
 * same place keep the order they were drawn in, at both of their ends.
 *
 * `boxes` is every frame by id; an arrow to a frame that isn't there has no
 * route (`null`), so the result lines up with `edges` one for one.
 */
export function routeFlowEdges(
  boxes: ReadonlyMap<string, FlowBox>,
  edges: ReadonlyArray<{ from: string; to: string }>,
): (FlowRoute | null)[] {
  const centre = (box: FlowBox, side: FlowSide): number =>
    side === "left" || side === "right" ? box.y + box.h / 2 : box.x + box.w / 2;
  const ends = edges.map((edge) => {
    const from = boxes.get(edge.from);
    const to = boxes.get(edge.to);
    if (!from || !to) return null;
    const [leave, enter] = sides(from, to);
    return { from, to, leave, enter };
  });

  // Every arrow end on each side of each frame, with where its arrow leads.
  const shared = new Map<string, { index: number; toward: number }[]>();
  const join = (frame: string, side: FlowSide, index: number, toward: number) => {
    const key = `${frame}\u0000${side}`;
    const list = shared.get(key);
    if (list) list.push({ index, toward });
    else shared.set(key, [{ index, toward }]);
  };
  ends.forEach((end, index) => {
    if (!end) return;
    const edge = edges[index] as { from: string; to: string };
    join(edge.from, end.leave, index, centre(end.to, end.leave));
    join(edge.to, end.enter, index, centre(end.from, end.enter));
  });
  const along = (frame: string, side: FlowSide, index: number): number => {
    const list = shared.get(`${frame}\u0000${side}`) ?? [];
    const order = [...list].sort((a, b) => a.toward - b.toward || a.index - b.index);
    return (order.findIndex((entry) => entry.index === index) + 1) / (order.length + 1);
  };

  return ends.map((end, index) => {
    if (!end) return null;
    const edge = edges[index] as { from: string; to: string };
    const leaves = along(edge.from, end.leave, index);
    return {
      ...curve(
        anchor(end.from, end.leave, leaves),
        end.leave,
        anchor(end.to, end.enter, along(edge.to, end.enter, index)),
        end.enter,
      ),
      lane: leaves < 0.5 ? -1 : leaves > 0.5 ? 1 : 0,
    };
  });
}

/**
 * The curve from a frame to a loose point — the arrow being dragged out of a
 * frame before it has somewhere to land.
 */
export function routeFlowDraft(from: FlowBox, to: FlowPoint): FlowRoute {
  const [leave, enter] = sides(from, { x: to.x, y: to.y, w: 0, h: 0 });
  return curve(anchor(from, leave, 0.5), leave, to, enter);
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
    c1,
    c2,
    // A cubic at t = 0.5.
    mid: {
      x: round((start.x + 3 * c1.x + 3 * c2.x + end.x) / 8),
      y: round((start.y + 3 * c1.y + 3 * c2.y + end.y) / 8),
    },
    angle: ARRIVAL[enter],
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

type Cubic = [FlowPoint, FlowPoint, FlowPoint, FlowPoint];
const cubicOf = (route: FlowRoute): Cubic => [route.start, route.c1, route.c2, route.end];
const lerp = (a: FlowPoint, b: FlowPoint, t: number): FlowPoint => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

/** De Casteljau: the two cubics a cubic is cut into at `t`. */
function split([p0, p1, p2, p3]: Cubic, t: number): [Cubic, Cubic] {
  const a = lerp(p0, p1, t);
  const b = lerp(p1, p2, t);
  const c = lerp(p2, p3, t);
  const ab = lerp(a, b, t);
  const bc = lerp(b, c, t);
  const at = lerp(ab, bc, t);
  return [
    [p0, a, ab, at],
    [at, bc, c, p3],
  ];
}

/**
 * The point a fraction `t` of the way along the arrow (0 where it leaves, 1
 * where it arrives), and the direction it is travelling there, in degrees.
 */
export function flowPointAt(route: FlowRoute, t: number): FlowPoint & { angle: number } {
  const [left, right] = split(cubicOf(route), t);
  const at = left[3];
  // The tangent runs between the two control points either side of the cut;
  // at an end, where one of them sits on the point, the far pair gives it.
  const before = t <= 0 ? right[0] : left[2];
  const after = t >= 1 ? left[3] : right[1];
  const dx = after.x - before.x;
  const dy = after.y - before.y;
  return {
    x: round(at.x),
    y: round(at.y),
    angle: dx === 0 && dy === 0 ? route.angle : (Math.atan2(dy, dx) * 180) / Math.PI,
  };
}

/** How finely an arrow is walked to find where it is nearest to, or under, something. */
const WALK_STEPS = 48;

/** The `t` at which the arrow passes closest to a board-space point. */
export function flowNearestT(route: FlowRoute, point: FlowPoint): number {
  const curve = cubicOf(route);
  const gap = (t: number) => {
    const at = split(curve, t)[0][3];
    return (at.x - point.x) ** 2 + (at.y - point.y) ** 2;
  };
  let best = 0;
  for (let step = 1; step <= WALK_STEPS; step++) {
    if (gap(step / WALK_STEPS) < gap(best)) best = step / WALK_STEPS;
  }
  // The nearest sample is within one step of the true nearest point.
  let low = Math.max(0, best - 1 / WALK_STEPS);
  let high = Math.min(1, best + 1 / WALK_STEPS);
  for (let pass = 0; pass < 12; pass++) {
    const third = (high - low) / 3;
    if (gap(low + third) < gap(high - third)) high -= third;
    else low += third;
  }
  return (low + high) / 2;
}

/**
 * The stretches of an arrow that are in view: everything but where it runs
 * under one of `covers` — the frames it is not an arrow of. Each stretch is a
 * `[from, to]` pair of `t`. An arrow that crosses a frame is drawn up to the
 * frame's edge and picked up again on the far side, so it never lies across a
 * screen; a frame's header row counts as part of the frame. `margin` stops it
 * that many board px short of the frame on every side, so where it ends is
 * seen to be an end and not a line running into the screen's own edge.
 */
export function flowVisibleSpans(
  route: FlowRoute,
  covers: readonly FlowBox[],
  margin = 0,
): [number, number][] {
  if (covers.length === 0) return [[0, 1]];
  const curve = cubicOf(route);
  const hidden = (t: number): boolean => {
    const at = split(curve, t)[0][3];
    return covers.some((box) => {
      const top = box.y - (box.head ?? 0) - margin;
      return (
        at.x > box.x - margin &&
        at.x < box.x + box.w + margin &&
        at.y > top &&
        at.y < box.y + box.h + margin
      );
    });
  };
  /** Where between a visible `t` and a hidden one the arrow meets the frame's edge. */
  const edge = (shown: number, covered: number): number => {
    let low = shown;
    let high = covered;
    for (let pass = 0; pass < 14; pass++) {
      const mid = (low + high) / 2;
      if (hidden(mid)) high = mid;
      else low = mid;
    }
    return low;
  };

  const spans: [number, number][] = [];
  let from: number | null = hidden(0) ? null : 0;
  for (let step = 1; step <= WALK_STEPS; step++) {
    const t = step / WALK_STEPS;
    const before = (step - 1) / WALK_STEPS;
    const covered = hidden(t);
    if (covered && from !== null) {
      spans.push([from, edge(before, t)]);
      from = null;
    } else if (!covered && from === null) {
      from = edge(t, before);
    }
  }
  if (from !== null) spans.push([from, 1]);
  return spans;
}

/** SVG path data for the part of an arrow between two `t`s. */
export function flowSpanPath(route: FlowRoute, from: number, to: number): string {
  if (from <= 0 && to >= 1) return route.d;
  const tail = from <= 0 ? cubicOf(route) : split(cubicOf(route), from)[1];
  const [p0, p1, p2, p3] = to >= 1 ? tail : split(tail, (to - from) / (1 - from))[0];
  return `M ${round(p0.x)} ${round(p0.y)} C ${round(p1.x)} ${round(p1.y)}, ${round(p2.x)} ${round(p2.y)}, ${round(p3.x)} ${round(p3.y)}`;
}

/**
 * Where an arrow's label goes when nobody has placed it: half-way along,
 * unless that is under a frame — then half-way along the longest stretch that
 * is in view, so a label is never dropped onto a screen by default.
 */
export function flowLabelT(spans: readonly [number, number][]): number {
  if (spans.some(([from, to]) => from <= 0.5 && to >= 0.5)) return 0.5;
  let best: [number, number] | undefined;
  for (const span of spans) {
    if (!best || span[1] - span[0] > best[1] - best[0]) best = span;
  }
  return best ? (best[0] + best[1]) / 2 : 0.5;
}
