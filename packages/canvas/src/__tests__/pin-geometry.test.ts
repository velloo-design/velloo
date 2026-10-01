import { describe, expect, test } from "bun:test";
import { clampInsideFrame, pileKey, pileTranslate } from "../pin-geometry.ts";

describe("pin geometry", () => {
  test("a marker is held a radius inside the frame, so it stays off the frame's header", () => {
    expect(clampInsideFrame(500, 100, 500)).toBe(
      "clamp(100px + (14px / var(--canvas-zoom, 1)), 500px, 500px - (14px / var(--canvas-zoom, 1)))",
    );
  });

  test("a pile fans out leftward by a fixed screen distance per marker", () => {
    expect(pileTranslate(0)).toBe("calc(-50% - 0px / var(--canvas-zoom, 1)) -50%");
    expect(pileTranslate(2)).toBe("calc(-50% - 36px / var(--canvas-zoom, 1)) -50%");
  });

  test("markers share a pile exactly when they resolve to the same spot", () => {
    const a = { left: clampInsideFrame(10, 0, 100), top: clampInsideFrame(20, 0, 100) };
    expect(pileKey(a)).toBe(pileKey({ ...a }));
    expect(pileKey(a)).not.toBe(pileKey({ ...a, top: clampInsideFrame(21, 0, 100) }));
  });
});
