import { describe, expect, test } from "bun:test";
import { flowFrameAt, routeFlowDraft, routeFlowEdge } from "../flow-geometry.ts";

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

  test("reports its axis, and no lane when it has the line to itself", () => {
    expect(routeFlowEdge(box(0, 0), box(600, 0))).toMatchObject({ axis: "x", lane: 0 });
    expect(routeFlowEdge(box(0, 0), box(0, 500))).toMatchObject({ axis: "y", lane: 0 });
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

  test("an opposite pair part to either side of the centre line", () => {
    const there = routeFlowEdge(box(0, 0), box(600, 0), true);
    const back = routeFlowEdge(box(600, 0), box(0, 0), true);
    expect(there.start.y).toBeLessThan(150);
    expect(back.start.y).toBeGreaterThan(150);
    expect(there.start.y).toBe(there.end.y);
    expect(back.mid.y - there.mid.y).toBe(28);
    expect([there.lane, back.lane]).toEqual([-1, 1]);
  });

  test("the twin shift never leaves a short frame's side", () => {
    const route = routeFlowEdge(box(0, 0, 400, 10), box(600, 0, 400, 10), true);
    expect(route.start.y).toBeGreaterThanOrEqual(0);
    expect(route.end.y).toBeGreaterThanOrEqual(0);
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
