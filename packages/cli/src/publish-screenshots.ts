import { buildBoardComposite } from "@velloo/renderer";
import type { Board, Frame, Screen, Viewport } from "@velloo/schema";

/**
 * Screenshot capture for `velloo publish`: one PNG per
 * published screen, one composite per published board, plus a cover — shipped
 * inside the same multipart bundle and indexed from design.json's
 * `screenshots` manifest.
 *
 * The cloud rejects the WHOLE publish when a screenshot violates its limits
 * (≤4MB each, ≤120 per publish, every referenced path present), so this module
 * enforces them client-side: an over-limit PNG is re-captured downscaled to
 * ≤1280px wide, a still-over-limit or failed shot is dropped from BOTH the
 * manifest and the file list, and a missing headless browser skips screenshots
 * entirely (publish keeps working browser-less).
 *
 * Rendering + rasterizing reuse the existing pipeline: callers thread in the
 * same `renderScreen` HTML the MCP `screenshot` tool uses and a `capture`
 * function wrapping `captureScreenshot` (@velloo/renderer) — injectable so the
 * limit logic tests without a browser.
 */

export const MAX_SCREENSHOT_BYTES = 4 * 1024 * 1024;
export const MAX_SCREENSHOT_COUNT = 120;
/** Downscale target when a capture exceeds the byte limit. */
export const DOWNSCALE_WIDTH = 1280;

export interface ScreenshotManifest {
  cover: string;
  screens: Record<string, string>;
  boards: Record<string, string>;
}

export interface BundleScreenshots {
  manifest: ScreenshotManifest;
  files: Array<{ path: string; bytes: Uint8Array }>;
}

export interface CaptureRequest {
  html: string;
  viewport: Viewport;
  fullPage: boolean;
  /** <1 shrinks the raster — the downscale retry for over-limit PNGs. */
  deviceScaleFactor: number;
}

export type CaptureFn = (req: CaptureRequest) => Promise<Uint8Array>;

export interface CaptureBundleScreenshotsOptions {
  screens: Screen[];
  /** Published boards, in publish order — the first becomes the cover. */
  boards: Board[];
  viewport: Viewport;
  /**
   * Render a screen to a full HTML document (same render the cloud shows).
   * `themeName` carries a board's pinned theme for its composite.
   */
  renderHtml: (screen: Screen, themeName?: string) => Promise<string>;
  capture: CaptureFn;
  warn: (message: string) => void;
  /**
   * Capture progress, so a long pass isn't silent. `total` counts the screens
   * plus the boards with frames; skipped and failed shots still advance `done`,
   * since it tracks work completed rather than files produced.
   */
  progress?: (done: number, total: number) => void;
}

function isBrowserMissing(err: unknown): boolean {
  return err instanceof Error && err.name === "BrowserMissingError";
}

/**
 * Capture every publishable screenshot, enforcing the cloud's limits.
 * Returns null when nothing could be captured (no browser, or every shot
 * failed) — the publish then simply omits the manifest.
 */
export async function captureBundleScreenshots(
  opts: CaptureBundleScreenshotsOptions,
): Promise<BundleScreenshots | null> {
  const { screens, boards, viewport, renderHtml, capture, warn, progress } = opts;
  const files: Array<{ path: string; bytes: Uint8Array }> = [];
  const manifest: ScreenshotManifest = { cover: "", screens: {}, boards: {} };
  // One slot stays reserved for the cover (a byte-copy of an existing shot).
  let budget = MAX_SCREENSHOT_COUNT - 1;
  const total = screens.length + boards.filter((b) => b.frames.length > 0).length;
  let done = 0;
  const advance = () => {
    done += 1;
    progress?.(done, total);
  };

  /** Capture; retry downscaled if over the byte limit; null if it stays over. */
  const shoot = async (
    html: string,
    vp: Viewport,
    fullPage: boolean,
  ): Promise<Uint8Array | null> => {
    let png = await capture({ html, viewport: vp, fullPage, deviceScaleFactor: 1 });
    if (png.byteLength > MAX_SCREENSHOT_BYTES && DOWNSCALE_WIDTH < vp.w) {
      png = await capture({
        html,
        viewport: vp,
        fullPage,
        deviceScaleFactor: DOWNSCALE_WIDTH / vp.w,
      });
    }
    return png.byteLength <= MAX_SCREENSHOT_BYTES ? png : null;
  };

  try {
    for (const screen of screens) {
      if (budget <= 0) {
        warn(`screenshot limit (${MAX_SCREENSHOT_COUNT}) reached — remaining shots skipped`);
        break;
      }
      try {
        const png = await shoot(await renderHtml(screen), viewport, true);
        if (!png) {
          warn(`screenshot of screen "${screen.id}" exceeds 4MB even downscaled — skipped`);
          continue;
        }
        const path = `screenshots/${screen.id}.png`;
        files.push({ path, bytes: png });
        manifest.screens[screen.id] = path;
        budget -= 1;
      } catch (err) {
        if (isBrowserMissing(err)) throw err;
        warn(`screenshot of screen "${screen.id}" failed — skipped (${message(err)})`);
      } finally {
        advance();
      }
    }

    const screenById = new Map(screens.map((s) => [s.id, s]));
    for (const board of boards) {
      if (board.frames.length === 0) continue;
      if (budget <= 0) {
        warn(`screenshot limit (${MAX_SCREENSHOT_COUNT}) reached — board shots skipped`);
        break;
      }
      try {
        const framed: Array<{ frame: Frame; html: string }> = [];
        for (const frame of board.frames) {
          const screen = screenById.get(frame.screen);
          if (!screen) continue;
          framed.push({ frame, html: await renderHtml(screen, board.theme) });
        }
        if (framed.length === 0) continue;
        const composite = buildBoardComposite(framed);
        const png = await shoot(composite.html, composite.viewport, false);
        if (!png) {
          warn(`screenshot of board "${board.id}" exceeds 4MB even downscaled — skipped`);
          continue;
        }
        const path = `screenshots/${board.id}.png`;
        files.push({ path, bytes: png });
        manifest.boards[board.id] = path;
        budget -= 1;
      } catch (err) {
        if (isBrowserMissing(err)) throw err;
        warn(`screenshot of board "${board.id}" failed — skipped (${message(err)})`);
      } finally {
        advance();
      }
    }
  } catch (err) {
    if (isBrowserMissing(err)) {
      warn("no headless browser available — publishing without screenshots");
      return null;
    }
    throw err;
  }

  // Cover: the first board shot, or the first screen shot.
  const coverSource =
    boards.map((b) => manifest.boards[b.id]).find((p) => p !== undefined) ??
    screens.map((s) => manifest.screens[s.id]).find((p) => p !== undefined);
  if (!coverSource) return null;
  const source = files.find((f) => f.path === coverSource);
  if (!source) return null;
  manifest.cover = "screenshots/cover.png";
  files.push({ path: manifest.cover, bytes: source.bytes });

  return { manifest, files };
}

function message(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.split("\n")[0] ?? msg;
}

// The board composite builder lives in @velloo/renderer (board-composite.ts),
// shared with the server export core so publish screenshots
// and user-facing board exports can never drift apart.
