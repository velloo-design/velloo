import { describe, expect, test } from "bun:test";
import {
  type FlowBox,
  flowFrameAt,
  flowLabelT,
  flowNearestT,
  flowPointAt,
  flowSpanPath,
  flowVisibleSpans,
  routeFlowDraft,
  routeFlowEdge,
  routeFlowEdges,
} from "../flow-geometry.ts";

const box = (x: number, y: number, w = 400, h = 300) => ({ x, y, w, h });

describe("routeFlowEdge", () => {
  test("frames in a row connect right edge to left edge, at mid-height", () => {
    const route = routeFlowEdge(box(0, 0), box(600, 0));
    expect(route.start).toEqual({ x: 400, y: 150 });
    expect(route.end).toEqual({ x: 600, y: 150 });
    expect(route.angle).toBe(0);
    expect(route.mid).toEqual({ x: 500, y: 150 });
    expect(route.d.startsWith("M 400 150 C ")).toBe(true);
  });

  test("an arrow pointing back along a row arrives travelling leftwards", () => {
    const route = routeFlowEdge(box(600, 0), box(0, 0));
    expect(route.start).toEqual({ x: 600, y: 150 });
    expect(route.end).toEqual({ x: 400, y: 150 });
    expect(route.angle).toBe(180);
  });

  test("frames in a column connect bottom edge to top edge", () => {
    const route = routeFlowEdge(box(0, 0), box(0, 500));
    expect(route.start).toEqual({ x: 200, y: 300 });
    expect(route.end).toEqual({ x: 200, y: 500 });
    expect(route.angle).toBe(90);
  });

  test("an arrow arriving from above stops clear of the frame's header row", () => {
    const route = routeFlowEdge(box(0, 0), { ...box(0, 500), head: 60 });
    expect(route.end).toEqual({ x: 200, y: 440 });
    // The header only sits above a frame: a side entry ignores it.
    expect(routeFlowEdge(box(0, 0), { ...box(600, 0), head: 60 }).end).toEqual({ x: 600, y: 150 });
  });

  test("a frame up and to the right still leaves by the side, not the top", () => {
    const route = routeFlowEdge(box(0, 400), box(600, 0));
    expect(route.start.x).toBe(400);
    expect(route.end.x).toBe(600);
  });

  test("overlapping frames fall back to the axis their centres differ on", () => {
    expect(routeFlowEdge(box(0, 0), box(300, 20)).start).toEqual({ x: 400, y: 150 });
    expect(routeFlowEdge(box(0, 0), box(20, 200)).start).toEqual({ x: 200, y: 300 });
  });
});

describe("routeFlowEdges", () => {
  const row = new Map([
    ["a", box(0, 0)],
    ["b", box(600, 0)],
    ["c", box(1200, 0)],
  ]);
  const ys = (route: { start: { y: number }; end: { y: number } } | null) => [
    route?.start.y,
    route?.end.y,
  ];

  test("an arrow with a side to itself uses its middle, as a lone arrow does", () => {
    const [ab, bc] = routeFlowEdges(row, [
      { from: "a", to: "b" },
      { from: "b", to: "c" },
    ]);
    expect(ab).toEqual(routeFlowEdge(box(0, 0), box(600, 0)));
    expect(ys(bc ?? null)).toEqual([150, 150]);
  });

  test("an arrow each way between two frames runs as two level lines, a third of the side apart", () => {
    const [there, back] = routeFlowEdges(row, [
      { from: "a", to: "b" },
      { from: "b", to: "a" },
    ]);
    expect(ys(there ?? null)).toEqual([100, 100]);
    expect(ys(back ?? null)).toEqual([200, 200]);
    // Each knows which half of the side it took, for its label to sit outside the pair.
    expect([there?.lane, back?.lane]).toEqual([-1, 1]);
    expect(routeFlowEdge(box(0, 0), box(600, 0)).lane).toBe(0);
  });

  test("a long arrow behind a row of frames gets a line of its own, clear of the short ones", () => {
    const [ab, bc, ca] = routeFlowEdges(row, [
      { from: "a", to: "b" },
      { from: "b", to: "c" },
      { from: "c", to: "a" },
    ]);
    // `c → a` leaves c's left beside `b → c` arriving, and arrives at a's
    // right beside `a → b` leaving: the second place on both sides.
    expect(ys(ca ?? null)).toEqual([200, 200]);
    expect(ys(ab ?? null)).toEqual([100, 150]);
    expect(ys(bc ?? null)).toEqual([150, 100]);
  });

  test("arrows fanning out from one side leave it in the order of where they lead", () => {
    const fan = new Map([
      ["hub", box(0, 400)],
      ["high", box(800, 0)],
      ["low", box(800, 900)],
    ]);
    // Drawn low-first: the order along the side is by destination, not by drawing.
    const [toLow, toHigh] = routeFlowEdges(fan, [
      { from: "hub", to: "low" },
      { from: "hub", to: "high" },
    ]);
    expect(toHigh?.start.y).toBe(500);
    expect(toLow?.start.y).toBe(600);
  });

  test("an arrow to a frame that isn't there has no route, and takes no place", () => {
    const routes = routeFlowEdges(row, [
      { from: "a", to: "gone" },
      { from: "a", to: "b" },
    ]);
    expect(routes[0]).toBeNull();
    expect(ys(routes[1] ?? null)).toEqual([150, 150]);
  });

  test("an arrow from above still stops clear of the header row", () => {
    const column = new Map<string, FlowBox>([
      ["top", box(0, 0)],
      ["under", { ...box(0, 500), head: 60 }],
    ]);
    expect(routeFlowEdges(column, [{ from: "top", to: "under" }])[0]?.end).toEqual({
      x: 200,
      y: 440,
    });
  });
});

describe("routeFlowDraft", () => {
  test("runs from the frame's nearest side to the pointer", () => {
    const route = routeFlowDraft(box(0, 0), { x: 700, y: 40 });
    expect(route.start).toEqual({ x: 400, y: 150 });
    expect(route.end).toEqual({ x: 700, y: 40 });
  });
});

describe("flowFrameAt", () => {
  const boxes = [
    { id: "a", ...box(0, 0) },
    { id: "b", ...box(600, 0) },
    { id: "over-a", ...box(100, 100) },
  ];

  test("finds the frame under a point", () => {
    expect(flowFrameAt(boxes, { x: 650, y: 20 })).toBe("b");
    expect(flowFrameAt(boxes, { x: 500, y: 20 })).toBeNull();
  });

  test("the frame painted last wins an overlap", () => {
    expect(flowFrameAt(boxes, { x: 150, y: 150 })).toBe("over-a");
    expect(flowFrameAt(boxes, { x: 20, y: 20 })).toBe("a");
  });

  test("reach widens every frame", () => {
    expect(flowFrameAt(boxes, { x: 590, y: 20 })).toBeNull();
    expect(flowFrameAt(boxes, { x: 590, y: 20 }, 12)).toBe("b");
  });
});

describe("walking along an arrow", () => {
  const level = routeFlowEdge(box(0, 0), box(600, 0));
  const upright = routeFlowEdge(box(0, 0), box(0, 500));

  test("its ends and its middle are where the route says they are", () => {
    expect(flowPointAt(level, 0)).toMatchObject(level.start);
    expect(flowPointAt(level, 1)).toMatchObject(level.end);
    expect(flowPointAt(level, 0.5)).toMatchObject(level.mid);
  });

  test("it reports which way the arrow is heading", () => {
    expect(flowPointAt(level, 0.5).angle).toBeCloseTo(0);
    expect(flowPointAt(upright, 0.5).angle).toBeCloseTo(90);
    // An arrow that bends: down-and-right from one frame to a lower one.
    const bent = routeFlowEdge(box(0, 0), box(900, 600));
    expect(flowPointAt(bent, 0).angle).toBeCloseTo(0);
    expect(flowPointAt(bent, 0.5).angle).toBeGreaterThan(20);
    expect(flowPointAt(bent, 1).angle).toBeCloseTo(0);
  });

  test("the nearest point to a pointer beside the arrow is the point across from it", () => {
    for (const t of [0.1, 0.33, 0.5, 0.8]) {
      const on = flowPointAt(level, t);
      expect(flowNearestT(level, { x: on.x, y: on.y - 40 })).toBeCloseTo(t, 2);
    }
    // Past either end, it is the end.
    expect(flowNearestT(level, { x: -500, y: 150 })).toBeCloseTo(0, 2);
    expect(flowNearestT(level, { x: 5000, y: 150 })).toBeCloseTo(1, 2);
  });
});

describe("flowVisibleSpans", () => {
  // Three frames in a row; the arrow from the first to the third runs level at y 150.
  const far = routeFlowEdge(box(0, 0), box(1200, 0));
  const between = box(600, 0);

  test("an arrow with nothing in its way is one stretch", () => {
    expect(flowVisibleSpans(far, [])).toEqual([[0, 1]]);
    expect(flowVisibleSpans(far, [box(600, 900)])).toEqual([[0, 1]]);
  });

  test("a frame in the way cuts it at the frame's two edges", () => {
    const spans = flowVisibleSpans(far, [between]);
    expect(spans).toHaveLength(2);
    const [[, enter], [exit]] = spans as [[number, number], [number, number]];
    expect(flowPointAt(far, enter).x).toBeCloseTo(600, 0);
    expect(flowPointAt(far, exit).x).toBeCloseTo(1000, 0);
    expect(spans[0]?.[0]).toBe(0);
    expect(spans[1]?.[1]).toBe(1);
  });

  test("two frames in the way leave three stretches", () => {
    const long = routeFlowEdge(box(0, 0), box(1800, 0));
    expect(flowVisibleSpans(long, [box(500, 0, 300), box(1100, 0, 300)])).toHaveLength(3);
  });

  test("a frame's header row is part of what covers the arrow", () => {
    // The arrow passes 30 above this frame: clear of the screen, under its header.
    const below = box(600, 180);
    expect(flowVisibleSpans(far, [below])).toEqual([[0, 1]]);
    expect(flowVisibleSpans(far, [{ ...below, head: 60 }])).toHaveLength(2);
  });

  test("an arrow that ends under a frame has no last stretch", () => {
    const spans = flowVisibleSpans(far, [box(1100, 0)]);
    expect(spans).toHaveLength(1);
    expect(spans[0]?.[1]).toBeLessThan(1);
  });
});

describe("flowSpanPath", () => {
  const route = routeFlowEdge(box(0, 0), box(900, 600));

  test("the whole arrow is the route's own path", () => {
    expect(flowSpanPath(route, 0, 1)).toBe(route.d);
  });

  test("a stretch starts and ends on the arrow, at the ts it was asked for", () => {
    const numbers = (d: string) => d.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
    const d = numbers(flowSpanPath(route, 0.2, 0.7));
    const from = flowPointAt(route, 0.2);
    const to = flowPointAt(route, 0.7);
    expect(d.slice(0, 2)).toEqual([from.x, from.y]);
    expect(d.slice(-2)).toEqual([to.x, to.y]);
  });

  test("a stretch from the start, or to the end, keeps that end", () => {
    expect(flowSpanPath(route, 0, 0.4).startsWith(`M ${route.start.x} ${route.start.y} `)).toBe(
      true,
    );
    expect(flowSpanPath(route, 0.6, 1).endsWith(`, ${route.end.x} ${route.end.y}`)).toBe(true);
  });
});

describe("flowLabelT", () => {
  test("half-way along, when that is in view", () => {
    expect(flowLabelT([[0, 1]])).toBe(0.5);
    expect(flowLabelT([[0.4, 0.9]])).toBe(0.5);
  });

  test("the middle of the longest stretch in view, when it isn't", () => {
    expect(
      flowLabelT([
        [0, 0.3],
        [0.7, 0.8],
      ]),
    ).toBe(0.15);
    expect(
      flowLabelT([
        [0, 0.1],
        [0.6, 1],
      ]),
    ).toBe(0.8);
  });

  test("an arrow wholly under frames still gets a place", () => {
    expect(flowLabelT([])).toBe(0.5);
  });
});
