import { describe, expect, test } from "bun:test";
import { frameRenderSrc, previewRenderSrc } from "../frame-render-src.ts";

const frame = { screen: "home", w: 1440, h: 900 };

describe("frameRenderSrc", () => {
  test("an unpinned frame follows the canvas default", () => {
    expect(
      frameRenderSrc({
        frame,
        canvasDefault: "dark",
        screenRevision: 2,
        themeVersion: 3,
      }),
    ).toContain("&mode=dark&v=2.3");
  });

  test("light and dark frame pins resolve independently and produce distinct sources", () => {
    const light = frameRenderSrc({
      frame: { ...frame, scheme: "light" },
      canvasDefault: "dark",
      screenRevision: 0,
      themeVersion: 0,
    });
    const dark = frameRenderSrc({
      frame: { ...frame, scheme: "dark" },
      canvasDefault: "light",
      screenRevision: 0,
      themeVersion: 0,
    });
    expect(light).toContain("&mode=light");
    expect(dark).toContain("&mode=dark");
    expect(dark).not.toBe(light);
  });
});

describe("previewRenderSrc", () => {
  test("uses the originating frame pin over the canvas default", () => {
    expect(
      previewRenderSrc({
        screenId: "home",
        width: 1200,
        height: 800,
        scheme: "dark",
        canvasDefault: "light",
        screenRevision: 1,
        themeVersion: 2,
      }),
    ).toContain("&mode=dark&v=1.2");
  });

  test("an unpinned preview keeps following the canvas default", () => {
    expect(
      previewRenderSrc({
        screenId: "home",
        width: 1200,
        height: 800,
        canvasDefault: "dark",
        screenRevision: 0,
        themeVersion: 0,
      }),
    ).toContain("&mode=dark");
  });
});
