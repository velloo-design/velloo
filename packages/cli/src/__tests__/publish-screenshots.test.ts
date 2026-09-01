import { describe, expect, test } from "bun:test";
import { buildBoardComposite } from "@velloo/renderer";
import type { Board, Screen } from "@velloo/schema";
import {
  type CaptureFn,
  type CaptureRequest,
  captureBundleScreenshots,
  DOWNSCALE_WIDTH,
  MAX_SCREENSHOT_BYTES,
  MAX_SCREENSHOT_COUNT,
} from "../publish-screenshots.ts";

/**
 * The capture side is injected, so the limit/manifest logic tests without a
 * browser: the real `captureScreenshot` wiring is covered by the (chromium-
 * gated) publish e2e test.
 */

const viewport = { w: 1440, h: 900 };

function screen(id: string): Screen {
  return { id, name: id, tree: { $ref: "Box" } } as Screen;
}

function board(id: string, screenIds: string[]): Board {
  return {
    id,
    name: id,
    frames: screenIds.map((s, i) => ({ id: `f${i}`, screen: s, x: i * 500, y: 0, w: 400, h: 300 })),
    groups: [],
  };
}

const renderHtml = async (s: Screen) => `<html><body>${s.id}</body></html>`;

function fixedCapture(size: number): CaptureFn {
  return async () => new Uint8Array(size);
}

test("captures one PNG per screen + per board + a cover, and indexes them", async () => {
  const requests: CaptureRequest[] = [];
  const capture: CaptureFn = async (req) => {
    requests.push(req);
    return new Uint8Array([requests.length]);
  };
  const warnings: string[] = [];
  const shots = await captureBundleScreenshots({
    screens: [screen("home"), screen("pricing")],
    boards: [board("main", ["home", "pricing"])],
    viewport,
    renderHtml,
    capture,
    warn: (m) => warnings.push(m),
  });

  expect(shots).not.toBeNull();
  expect(shots?.manifest).toEqual({
    cover: "screenshots/cover.png",
    screens: { home: "screenshots/home.png", pricing: "screenshots/pricing.png" },
    boards: { main: "screenshots/main.png" },
  });
  const byPath = new Map(shots?.files.map((f) => [f.path, f.bytes]));
  expect([...byPath.keys()].sort()).toEqual([
    "screenshots/cover.png",
    "screenshots/home.png",
    "screenshots/main.png",
    "screenshots/pricing.png",
  ]);
  // The cover is the board shot (byte-identical copy).
  expect(byPath.get("screenshots/cover.png")).toEqual(byPath.get("screenshots/main.png"));
  // Screens capture full-page at the publish viewport; boards clip to their composite.
  expect(requests[0]?.fullPage).toBe(true);
  expect(requests[2]?.fullPage).toBe(false);
  expect(warnings).toEqual([]);
});

test("runs captures concurrently without exceeding the renderer cap", async () => {
  let active = 0;
  let peak = 0;
  const capture: CaptureFn = async () => {
    active += 1;
    peak = Math.max(peak, active);
    await Bun.sleep(20);
    active -= 1;
    return new Uint8Array(4);
  };
  await captureBundleScreenshots({
    screens: Array.from({ length: 8 }, (_, index) => screen(`s${index}`)),
    boards: [],
    viewport,
    renderHtml,
    capture,
    warn: () => {},
  });
  expect(peak).toBe(3);
});

test("changed-only selectors skip unaffected screens and boards", async () => {
  const shots = await captureBundleScreenshots({
    screens: [screen("home"), screen("pricing")],
    boards: [board("main", ["home"]), board("sales", ["pricing"])],
    screenIds: new Set(["pricing"]),
    boardIds: new Set(["sales"]),
    viewport,
    renderHtml,
    capture: fixedCapture(4),
    warn: () => {},
  });
  expect(shots?.manifest.screens).toEqual({ pricing: "screenshots/pricing.png" });
  expect(shots?.manifest.boards).toEqual({ sales: "screenshots/sales.png" });
});

test("cover falls back to the first screen when there are no boards", async () => {
  const shots = await captureBundleScreenshots({
    screens: [screen("home")],
    boards: [],
    viewport,
    renderHtml,
    capture: fixedCapture(10),
    warn: () => {},
  });
  const cover = shots?.files.find((f) => f.path === "screenshots/cover.png");
  const home = shots?.files.find((f) => f.path === "screenshots/home.png");
  expect(cover?.bytes).toEqual(home?.bytes);
});

test("an over-4MB capture retries downscaled to ≤1280px wide", async () => {
  const requests: CaptureRequest[] = [];
  const capture: CaptureFn = async (req) => {
    requests.push(req);
    return new Uint8Array(req.deviceScaleFactor === 1 ? MAX_SCREENSHOT_BYTES + 1 : 1024);
  };
  const shots = await captureBundleScreenshots({
    screens: [screen("home")],
    boards: [],
    viewport,
    renderHtml,
    capture,
    warn: () => {},
  });
  expect(requests.length).toBe(2);
  expect(requests[1]?.deviceScaleFactor).toBeCloseTo(DOWNSCALE_WIDTH / viewport.w);
  expect(shots?.manifest.screens.home).toBe("screenshots/home.png");
  expect(shots?.files.find((f) => f.path === "screenshots/home.png")?.bytes.byteLength).toBe(1024);
});

test("a shot that stays over 4MB after downscale is dropped, not fatal", async () => {
  const warnings: string[] = [];
  const capture: CaptureFn = async (req) =>
    new Uint8Array(req.html.includes("home") ? MAX_SCREENSHOT_BYTES + 1 : 8);
  const shots = await captureBundleScreenshots({
    screens: [screen("home"), screen("pricing")],
    boards: [],
    viewport,
    renderHtml,
    capture,
    warn: (m) => warnings.push(m),
  });
  expect(shots?.manifest.screens).toEqual({ pricing: "screenshots/pricing.png" });
  expect(shots?.files.map((f) => f.path).sort()).toEqual([
    "screenshots/cover.png",
    "screenshots/pricing.png",
  ]);
  expect(warnings.some((w) => w.includes('"home"') && w.includes("4MB"))).toBe(true);
});

test("caps the bundle at 120 screenshots including the cover", async () => {
  const warnings: string[] = [];
  const screens = Array.from({ length: 130 }, (_, i) => screen(`s${i}`));
  const shots = await captureBundleScreenshots({
    screens,
    boards: [board("main", ["s0"])],
    viewport,
    renderHtml,
    capture: fixedCapture(4),
    warn: (m) => warnings.push(m),
  });
  expect(shots?.files.length).toBe(MAX_SCREENSHOT_COUNT);
  expect(Object.keys(shots?.manifest.screens ?? {}).length).toBe(MAX_SCREENSHOT_COUNT - 1);
  expect(shots?.manifest.boards).toEqual({});
  expect(warnings.some((w) => w.includes(String(MAX_SCREENSHOT_COUNT)))).toBe(true);
});

test("a missing headless browser skips screenshots entirely (returns null)", async () => {
  const warnings: string[] = [];
  const capture: CaptureFn = async () => {
    const err = new Error("Velloo screenshots need a headless browser.");
    err.name = "BrowserMissingError";
    throw err;
  };
  const shots = await captureBundleScreenshots({
    screens: [screen("home")],
    boards: [],
    viewport,
    renderHtml,
    capture,
    warn: (m) => warnings.push(m),
  });
  expect(shots).toBeNull();
  expect(warnings.some((w) => w.includes("without screenshots"))).toBe(true);
});

test("a per-screen render failure skips that screen and keeps the rest", async () => {
  const warnings: string[] = [];
  const shots = await captureBundleScreenshots({
    screens: [screen("broken"), screen("ok")],
    boards: [],
    viewport,
    renderHtml: async (s) => {
      if (s.id === "broken") throw new Error("render exploded");
      return "<html></html>";
    },
    capture: fixedCapture(4),
    warn: (m) => warnings.push(m),
  });
  expect(shots?.manifest.screens).toEqual({ ok: "screenshots/ok.png" });
  expect(warnings.some((w) => w.includes('"broken"'))).toBe(true);
});

describe("buildBoardComposite", () => {
  test("lays frames out in board space and scales wide boards to ≤1600px", () => {
    const html = "<html><body>x</body></html>";
    const wide = buildBoardComposite([
      { frame: { id: "a", screen: "s", x: 0, y: 0, w: 1440, h: 900 }, html },
      { frame: { id: "b", screen: "s", x: 1500, y: 100, w: 1440, h: 900 }, html },
    ]);
    expect(wide.viewport.w).toBe(1600);
    expect(wide.viewport.h).toBeLessThan(1600);
    expect(wide.html).toContain("srcdoc=");
    expect(wide.html.match(/<iframe/g)?.length).toBe(2);

    const small = buildBoardComposite([
      { frame: { id: "a", screen: "s", x: 10, y: 20, w: 400, h: 300 }, html },
    ]);
    // 400 + 2×24 padding — no upscaling of small boards.
    expect(small.viewport).toEqual({ w: 448, h: 348 });
    expect(small.html).toContain("left:24px;top:24px");
  });
});
