import { describe, expect, test } from "bun:test";
import type { CaptureManifest, DomExtract } from "@velloo/renderer";
import { pngSize } from "@velloo/renderer";
import { storedCaptureDom, storedCaptureRaster } from "../compare-to-url.ts";

const FULL_PAGE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAoAAAAeCAYAAAAVdY8wAAAAUElEQVR4AY3BAQ0AAAyDMEjm3/JvgVbgEBAQEBAQEBAQJs2kmTSTZtJMmkkzaSbNpJk0k2bSTJpJM2kmzaSZNJNm0kyaSTNpJs2kmTSTZtI8Vd4Bm0qYQnMAAAAASUVORK5CYII=",
  "base64",
);
const VIEWPORT_AT_Y_10 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAMElEQVR4AY3BsQ3AQBAEIUba6Pvv127hoMcnhBBCCCGWm+VmuVlulpvlZrlZbpabH9lLAUHXg2rRAAAAAElFTkSuQmCC",
  "base64",
);

function manifest(mode: "full-page" | "viewport"): CaptureManifest {
  return {
    id: "capture",
    url: "https://example.test",
    finalUrl: "https://example.test",
    title: "Example",
    capturedAt: "2026-09-14T00:00:00.000Z",
    viewport: { w: 10, h: 10 },
    files: ["page.png"],
    assetCount: 0,
    nodeCount: 0,
    themeOnly: false,
    captureVersion: 2,
    kind: "page",
    geometry: {
      viewportCss: { width: 10, height: 10 },
      documentCssHeight: 30,
      scrollCss: { x: 0, y: 10 },
      devicePixelRatio: 1,
      screenshot: { mode, bitmapWidth: 10, bitmapHeight: mode === "viewport" ? 10 : 30 },
    },
    stability: { status: "stable", attempts: 1 },
  };
}

describe("storedCaptureRaster", () => {
  test("fullPage false crops a full-page capture to the recorded viewport", () => {
    const result = storedCaptureRaster(FULL_PAGE, manifest("full-page"), false);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(pngSize(result.png)).toEqual({ width: 10, height: 10 });
    expect(result.png).toEqual(VIEWPORT_AT_Y_10);
  });

  test("a viewport-only capture cannot masquerade as a full-page reference", () => {
    const png = VIEWPORT_AT_Y_10;
    const full = storedCaptureRaster(png, manifest("viewport"), true);
    expect(full.ok).toBe(false);
    const viewport = storedCaptureRaster(png, manifest("viewport"), false);
    expect(viewport).toEqual({ ok: true, png });
  });

  test("viewport comparison shifts DOM rects into the cropped image's coordinates", () => {
    const dom: DomExtract = {
      url: "https://example.test",
      title: "Example",
      viewport: { w: 10, h: 10 },
      documentHeight: 30,
      truncated: false,
      nodes: [
        {
          i: 0,
          parent: null,
          depth: 0,
          tag: "section",
          rect: { x: 0, y: 12, w: 10, h: 5 },
          style: {},
        },
      ],
    };
    const capture = manifest("full-page");
    const shifted = storedCaptureDom(dom, capture.geometry, false);
    expect(shifted.documentHeight).toBe(10);
    expect(shifted.nodes[0]?.rect.y).toBe(2);
    expect(storedCaptureDom(dom, capture.geometry, true)).toBe(dom);
  });
});
