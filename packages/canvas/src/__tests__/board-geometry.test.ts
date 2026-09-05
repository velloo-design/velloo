import { describe, expect, test } from "bun:test";
import {
  contentBounds,
  fitToContent,
  focusFrame,
  focusRect,
  iframeRectToBoard,
  MAX_ZOOM,
  MIN_ZOOM,
  wheelZoomFactor,
  zoomAtPoint,
} from "../board-geometry.ts";

/**
 * Pan/zoom math is a cross-repo contract: velloo-cloud's read-only share
 * viewer sibling-imports this file so both surfaces frame a board identically.
 * A silent change here desyncs two repos with nothing to catch it, so the
 * invariants — not just the happy path — are pinned.
 */

const frame = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });

describe("contentBounds", () => {
  test("pads only below each frame, by the chrome allowance", () => {
    expect(contentBounds([frame(0, 0, 100, 200)], 60)).toEqual({
      minX: 0,
      minY: 0,
      maxX: 100,
      maxY: 260,
    });
  });

  test("spans every frame, not just the first", () => {
    const bounds = contentBounds([frame(100, 50, 200, 100), frame(-40, 400, 80, 80)], 0);
    expect(bounds).toEqual({ minX: -40, minY: 50, maxX: 300, maxY: 480 });
  });

  test("is null for an empty board", () => {
    expect(contentBounds([])).toBeNull();
  });
});

describe("fitToContent", () => {
  test("centers the content box in the viewport", () => {
    const view = fitToContent([frame(0, 0, 400, 300)], 1000, 800, 80);
    expect(view).not.toBeNull();
    if (!view) return;
    // Content center (200, 180) must land at the viewport center (500, 400).
    expect(view.pan.x + 200 * view.zoom).toBeCloseTo(500, 0);
    expect(view.pan.y + 180 * view.zoom).toBeCloseTo(400, 0);
  });

  test("never up-scales: a small board fits at 1.0, not blown up", () => {
    const view = fitToContent([frame(0, 0, 100, 100)], 2000, 2000);
    expect(view?.zoom).toBe(1);
  });

  test("scales down to fit an oversized board, honoring the margin", () => {
    const view = fitToContent([frame(0, 0, 4000, 100)], 1000, 1000, 80);
    // (1000 - 160) / 4000 = 0.21
    expect(view?.zoom).toBeCloseTo(0.21, 5);
  });

  test("clamps at MIN_ZOOM rather than vanishing", () => {
    const view = fitToContent([frame(0, 0, 1_000_000, 100)], 1000, 1000);
    expect(view?.zoom).toBe(MIN_ZOOM);
  });

  test("is null for an empty board or a viewport that hasn't laid out", () => {
    expect(fitToContent([], 1000, 800)).toBeNull();
    expect(fitToContent([frame(0, 0, 100, 100)], 10, 800)).toBeNull();
    expect(fitToContent([frame(0, 0, 100, 100)], 1000, 10)).toBeNull();
  });
});

describe("focusFrame", () => {
  test("centers the frame plus its chrome allowance", () => {
    const view = focusFrame(frame(500, 500, 400, 200), 1000, 800, 80, 60);
    expect(view).not.toBeNull();
    if (!view) return;
    const cx = 500 + 200;
    const cy = 500 + (200 + 60) / 2;
    expect(view.pan.x + cx * view.zoom).toBeCloseTo(500, 0);
    expect(view.pan.y + cy * view.zoom).toBeCloseTo(400, 0);
  });

  test("caps at 1.0 so a small frame lands at natural size", () => {
    expect(focusFrame(frame(0, 0, 50, 50), 1600, 1200)?.zoom).toBe(1);
  });

  test("is null before the viewport lays out", () => {
    expect(focusFrame(frame(0, 0, 400, 200), 10, 10)).toBeNull();
  });
});

describe("focusRect", () => {
  test("centers the rect with no chrome allowance", () => {
    const view = focusRect(frame(0, 0, 200, 100), 1000, 800, 120, 1);
    expect(view).not.toBeNull();
    if (!view) return;
    expect(view.pan.x + 100 * view.zoom).toBeCloseTo(500, 0);
    expect(view.pan.y + 50 * view.zoom).toBeCloseTo(400, 0);
  });

  test("honors the caller's zoom ceiling so a small node isn't blown up", () => {
    expect(focusRect(frame(0, 0, 20, 20), 1600, 1200, 120, 1.5)?.zoom).toBe(1.5);
    expect(focusRect(frame(0, 0, 20, 20), 1600, 1200, 120, 1)?.zoom).toBe(1);
  });

  test("survives a zero-sized rect instead of dividing by zero", () => {
    const view = focusRect(frame(10, 10, 0, 0), 1000, 800);
    expect(view?.zoom).toBe(1);
    expect(Number.isFinite(view?.pan.x ?? Number.NaN)).toBe(true);
  });
});

describe("iframeRectToBoard", () => {
  test("offsets by the frame origin and the chrome inset", () => {
    expect(
      iframeRectToBoard(frame(100, 200, 800, 600), { x: 0, y: 40 }, frame(10, 20, 50, 30)),
    ).toEqual({ x: 110, y: 260, w: 50, h: 30 });
  });

  test("clamps a scrolled-above rect to the top of the frame viewport", () => {
    // getBoundingClientRect goes negative once the iframe scrolls.
    const box = iframeRectToBoard(frame(0, 0, 800, 600), { x: 0, y: 0 }, frame(-200, -400, 50, 30));
    expect(box).toEqual({ x: 0, y: 0, w: 50, h: 30 });
  });

  test("clamps a rect scrolled past the bottom edge back inside the frame", () => {
    const box = iframeRectToBoard(frame(0, 0, 800, 600), { x: 0, y: 0 }, frame(900, 700, 50, 30));
    expect(box).toEqual({ x: 750, y: 570, w: 50, h: 30 });
  });

  test("a rect larger than the frame pins to the origin rather than going negative", () => {
    const box = iframeRectToBoard(frame(0, 0, 100, 100), { x: 0, y: 0 }, frame(50, 50, 400, 400));
    expect(box).toEqual({ x: 0, y: 0, w: 400, h: 400 });
  });
});

describe("zoomAtPoint", () => {
  test("pins the world coordinate under the cursor across the zoom step", () => {
    const current = { pan: { x: 120, y: -40 }, zoom: 0.8 };
    const [anchorX, anchorY] = [640, 360];
    const worldX = (anchorX - current.pan.x) / current.zoom;
    const worldY = (anchorY - current.pan.y) / current.zoom;

    const next = zoomAtPoint(anchorX, anchorY, 1.05, current);
    expect(next.zoom).toBeCloseTo(0.84, 10);
    // Rounded pan, so allow a sub-pixel drift — but no more.
    expect(next.pan.x + worldX * next.zoom).toBeCloseTo(anchorX, 0);
    expect(next.pan.y + worldY * next.zoom).toBeCloseTo(anchorY, 0);
  });

  test("clamps to MIN_ZOOM and MAX_ZOOM", () => {
    expect(zoomAtPoint(0, 0, 0.5, { pan: { x: 0, y: 0 }, zoom: MIN_ZOOM * 1.2 }).zoom).toBe(
      MIN_ZOOM,
    );
    expect(zoomAtPoint(0, 0, 2, { pan: { x: 0, y: 0 }, zoom: MAX_ZOOM * 0.9 }).zoom).toBe(MAX_ZOOM);
  });

  test("returns the same view object when already clamped, so callers can skip a re-render", () => {
    const atFloor = { pan: { x: 5, y: 5 }, zoom: MIN_ZOOM };
    expect(zoomAtPoint(0, 0, 0.95, atFloor)).toBe(atFloor);
    const atCeiling = { pan: { x: 5, y: 5 }, zoom: MAX_ZOOM };
    expect(zoomAtPoint(0, 0, 1.05, atCeiling)).toBe(atCeiling);
  });
});

describe("wheelZoomFactor", () => {
  test("scroll down zooms out, scroll up zooms in", () => {
    expect(wheelZoomFactor(120)).toBeLessThan(1);
    expect(wheelZoomFactor(-120)).toBeGreaterThan(1);
  });

  test("a wheel tick and its opposite cancel exactly", () => {
    // Not 0.95/1.05: those multiply to 0.9975, so rocking the wheel back and
    // forth ratcheted the board down with no way back to exactly 1.0.
    expect(wheelZoomFactor(120) * wheelZoomFactor(-120)).toBe(1);
  });

  test("zoom comes home after a long oscillation instead of drifting", () => {
    let view = { pan: { x: 0, y: 0 }, zoom: 1 };
    for (let i = 0; i < 200; i++) {
      view = zoomAtPoint(400, 300, wheelZoomFactor(120), view);
      view = zoomAtPoint(400, 300, wheelZoomFactor(-120), view);
    }
    expect(view.zoom).toBeCloseTo(1, 10);
  });

  test("pan comes home too — rounding must not accumulate", () => {
    // Every step rounds the pan to whole pixels. That is fine as long as the
    // error cancels; if it accumulates, the board slides away under a wheel
    // the user is only rocking back and forth.
    let view = { pan: { x: 120, y: -40 }, zoom: 1 };
    for (let i = 0; i < 200; i++) {
      view = zoomAtPoint(517, 293, wheelZoomFactor(120), view);
      view = zoomAtPoint(517, 293, wheelZoomFactor(-120), view);
    }
    expect(Math.abs(view.pan.x - 120)).toBeLessThanOrEqual(1);
    expect(Math.abs(view.pan.y + 40)).toBeLessThanOrEqual(1);
  });
});
