import { describe, expect, test } from "bun:test";
import { clampResizeToNeighbors, type Rect, resolveMoveCollision } from "../collision.ts";

/**
 * Resize expands until it actually touches a neighbor (no
 * pre-emptive gutter, no wrong-axis clamping) and a move resolves collisions
 * by nudging the dragged frame flush against what it hit — deterministically,
 * never displacing neighbors.
 */

const rect = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });

describe("clampResizeToNeighbors", () => {
  const start = rect(0, 0, 200, 200);

  test("no neighbors — request passes through", () => {
    expect(clampResizeToNeighbors(start, [], 500, 400)).toEqual({ w: 500, h: 400 });
  });

  test("grows east until it actually touches the right neighbor (no gutter)", () => {
    const neighbor = rect(300, 50, 100, 100);
    expect(clampResizeToNeighbors(start, [neighbor], 500, 200)).toEqual({ w: 300, h: 200 });
  });

  test("stops short of the clamp when the request never reaches the neighbor", () => {
    const neighbor = rect(300, 50, 100, 100);
    expect(clampResizeToNeighbors(start, [neighbor], 280, 200)).toEqual({ w: 280, h: 200 });
  });

  test("grows south until it touches the neighbor below", () => {
    const neighbor = rect(0, 350, 100, 100);
    expect(clampResizeToNeighbors(start, [neighbor], 200, 600)).toEqual({ w: 200, h: 350 });
  });

  test("an east drag is not blocked by a frame that is really below", () => {
    // Diagonal-ish neighbor mostly below: clamping height loses less area
    // than clamping width, so the width request survives.
    const below = rect(150, 400, 500, 100);
    expect(clampResizeToNeighbors(start, [below], 800, 500)).toEqual({ w: 800, h: 400 });
  });

  test("a diagonal neighbor clamps the axis that preserves more area", () => {
    const diagonal = rect(600, 600, 100, 100);
    // Requesting 700x650: clamping w to 600 keeps 600*650; clamping h to 600
    // keeps 700*600 — larger, so height clamps.
    expect(clampResizeToNeighbors(start, [diagonal], 700, 650)).toEqual({ w: 700, h: 600 });
  });

  test("chains across multiple neighbors", () => {
    const right = rect(500, 0, 50, 200);
    const below = rect(0, 400, 200, 50);
    expect(clampResizeToNeighbors(start, [right, below], 900, 900)).toEqual({ w: 500, h: 400 });
  });

  test("a neighbor already overlapping the start rect is ignored", () => {
    const overlapping = rect(100, 100, 50, 50);
    expect(clampResizeToNeighbors(start, [overlapping], 500, 500)).toEqual({ w: 500, h: 500 });
  });

  test("shrinking is never blocked", () => {
    const right = rect(300, 0, 100, 200);
    expect(clampResizeToNeighbors(start, [right], 150, 150)).toEqual({ w: 150, h: 150 });
  });

  test("never clamps below the gesture's start size", () => {
    // The neighbor's left edge (150) sits inside the start width (200), so a
    // width clamp would shrink the frame below its gesture-start size — the
    // height axis takes the clamp instead, at contact.
    const tight = rect(150, 300, 100, 100);
    expect(clampResizeToNeighbors(start, [tight], 200, 500)).toEqual({ w: 200, h: 300 });
  });
});

describe("resolveMoveCollision", () => {
  const size = { w: 200, h: 200 };
  const fallback = { x: 0, y: 0 };

  test("a free position passes through untouched", () => {
    const neighbor = rect(500, 500, 100, 100);
    expect(resolveMoveCollision(size, [neighbor], { x: 250, y: 250 }, fallback)).toEqual({
      x: 250,
      y: 250,
    });
  });

  test("touching edges is not a collision — snap-adjacent placements stand", () => {
    const neighbor = rect(300, 0, 100, 200);
    expect(resolveMoveCollision(size, [neighbor], { x: 100, y: 0 }, fallback)).toEqual({
      x: 100,
      y: 0,
    });
  });

  test("a shallow horizontal overlap snaps flush against the neighbor's left edge", () => {
    const neighbor = rect(300, 0, 200, 200);
    // Overlapping 20px into the neighbor: least penetration is pushing left.
    expect(resolveMoveCollision(size, [neighbor], { x: 120, y: 0 }, fallback)).toEqual({
      x: 100,
      y: 0,
    });
  });

  test("a shallow vertical overlap snaps above the neighbor", () => {
    const neighbor = rect(0, 300, 200, 200);
    // 50px of the frame's bottom dips into the neighbor: least penetration
    // is pushing back up, flush above it.
    expect(resolveMoveCollision(size, [neighbor], { x: 0, y: 150 }, fallback)).toEqual({
      x: 0,
      y: 100,
    });
  });

  test("past the neighbor's midline the frame pops out the far side", () => {
    const neighbor = rect(300, 0, 200, 200);
    // Deep overlap, closer to the neighbor's right edge.
    expect(resolveMoveCollision(size, [neighbor], { x: 450, y: 0 }, fallback)).toEqual({
      x: 500,
      y: 0,
    });
  });

  test("one push landing on a second neighbor keeps resolving", () => {
    const a = rect(300, 0, 100, 200);
    const b = rect(420, 0, 100, 200);
    // Deep in `a`'s right half → pushed right to x=400 → now inside `b` →
    // pushed right again to b's far edge.
    expect(resolveMoveCollision(size, [a, b], { x: 380, y: 0 }, fallback)).toEqual({
      x: 520,
      y: 0,
    });
  });

  test("an unresolvable squeeze falls back to the gesture start", () => {
    // A 300-tall frame between two wall bands 200 apart: every push out of
    // one wall lands inside the other, so resolution ping-pongs and gives up.
    const walls = [rect(-400, -400, 1000, 400), rect(-400, 200, 1000, 400)];
    const resolved = resolveMoveCollision(
      { w: 200, h: 300 },
      walls,
      { x: 100, y: -50 },
      { x: 999, y: 999 },
    );
    expect(resolved).toEqual({ x: 999, y: 999 });
  });
});
