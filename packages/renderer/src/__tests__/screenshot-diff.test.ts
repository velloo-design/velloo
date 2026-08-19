import { describe, expect, test } from "bun:test";
import { PNG } from "pngjs";
import { cropPng, diffPngs, sideBySidePng, unionRegion } from "../screenshot-diff.ts";

/** Solid-color PNG with optional painted rectangles. */
function synth(
  width: number,
  height: number,
  rects: Array<{ x: number; y: number; w: number; h: number; rgb: [number, number, number] }> = [],
): Buffer {
  const png = new PNG({ width, height });
  for (let i = 0; i < width * height; i++) {
    png.data[i * 4] = 255;
    png.data[i * 4 + 1] = 255;
    png.data[i * 4 + 2] = 255;
    png.data[i * 4 + 3] = 255;
  }
  for (const r of rects) {
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        const i = (y * width + x) * 4;
        png.data[i] = r.rgb[0];
        png.data[i + 1] = r.rgb[1];
        png.data[i + 2] = r.rgb[2];
      }
    }
  }
  return PNG.sync.write(png);
}

describe("diffPngs", () => {
  test("identical images → zero change, no regions", () => {
    const img = synth(200, 100, [{ x: 10, y: 10, w: 40, h: 20, rgb: [20, 20, 220] }]);
    const d = diffPngs(img, img);
    expect(d.changedPixels).toBe(0);
    expect(d.changedRatio).toBe(0);
    expect(d.regions).toEqual([]);
    expect(d.heightDelta).toBe(0);
  });

  test("a single changed rectangle clusters into one region containing it", () => {
    const before = synth(200, 100);
    const after = synth(200, 100, [{ x: 64, y: 32, w: 48, h: 24, rgb: [200, 30, 30] }]);
    const d = diffPngs(before, after);
    expect(d.changedPixels).toBeGreaterThan(1000);
    expect(d.regions.length).toBe(1);
    const r = d.regions[0];
    if (!r) throw new Error("region missing");
    // Region is cell-aligned; must contain the painted box.
    expect(r.x).toBeLessThanOrEqual(64);
    expect(r.y).toBeLessThanOrEqual(32);
    expect(r.x + r.w).toBeGreaterThanOrEqual(64 + 48);
    expect(r.y + r.h).toBeGreaterThanOrEqual(32 + 24);
  });

  test("two far-apart changes cluster into two regions", () => {
    const before = synth(400, 200);
    const after = synth(400, 200, [
      { x: 16, y: 16, w: 32, h: 32, rgb: [200, 30, 30] },
      { x: 320, y: 140, w: 40, h: 32, rgb: [30, 160, 30] },
    ]);
    const d = diffPngs(before, after);
    expect(d.regions.length).toBe(2);
  });

  test("height growth pads and counts as change, but content overlap is unchanged", () => {
    const before = synth(100, 100);
    const after = synth(100, 160);
    const d = diffPngs(before, after);
    expect(d.heightDelta).toBe(60);
    expect(d.changedPixels).toBeGreaterThan(0);
    expect(d.height).toBe(160);
    // The overlapping top 100 rows are identical — the whole-page diff is pure
    // height padding, so the normalized content score sees zero change.
    expect(d.changedRatio).toBeGreaterThan(0);
    expect(d.contentChangedRatio).toBe(0);
  });

  test("contentChangedRatio equals changedRatio when heights match", () => {
    const before = synth(200, 100);
    const after = synth(200, 100, [{ x: 64, y: 32, w: 48, h: 24, rgb: [200, 30, 30] }]);
    const d = diffPngs(before, after);
    expect(d.contentChangedRatio).toBe(d.changedRatio);
  });
});

describe("cropPng / unionRegion", () => {
  test("crops to the padded region, clamped to bounds", () => {
    const img = synth(200, 100);
    const out = PNG.sync.read(cropPng(img, { x: 0, y: 0, w: 50, h: 40 }, 24));
    expect(out.width).toBe(98); // x clamps to 0; w = 50 + 2*24
    expect(out.height).toBe(88);
  });

  test("unionRegion bounds a region list", () => {
    expect(
      unionRegion([
        { x: 10, y: 10, w: 20, h: 20 },
        { x: 100, y: 50, w: 30, h: 10 },
      ]),
    ).toEqual({ x: 10, y: 10, w: 120, h: 50 });
  });
});

describe("sideBySidePng", () => {
  test("composes left+right with gutter at union height", () => {
    const left = synth(100, 80, [{ x: 0, y: 0, w: 10, h: 10, rgb: [200, 0, 0] }]);
    const right = synth(120, 140, [{ x: 0, y: 0, w: 10, h: 10, rgb: [0, 0, 200] }]);
    const out = PNG.sync.read(sideBySidePng(left, right, 12));
    expect(out.width).toBe(100 + 12 + 120);
    expect(out.height).toBe(140);
    // Left pixel lands at origin; right pixel lands past left width + gutter.
    expect(out.data[0]).toBe(200);
    const rightStart = (0 * out.width + 112) * 4;
    expect(out.data[rightStart + 2]).toBe(200);
    // Gutter column is white.
    const gutterIdx = (0 * out.width + 105) * 4;
    expect(out.data[gutterIdx]).toBe(255);
  });
});
