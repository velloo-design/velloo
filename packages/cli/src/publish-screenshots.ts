import { buildBoardComposite, MAX_CONCURRENT_RENDERS } from "@velloo/renderer";
import type { Board, Frame, FrameScheme, Screen, Viewport } from "@velloo/schema";

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
  /** Optional changed-only slice. All screens still remain available to board composites. */
  screenIds?: ReadonlySet<string>;
  /** Optional changed-only board slice. */
  boardIds?: ReadonlySet<string>;
  viewport: Viewport;
  /**
   * Render a screen to a full HTML document (same render the cloud shows).
   * `themeName` carries a board's pinned theme for its composite.
   */
  renderHtml: (screen: Screen, themeName?: string, scheme?: FrameScheme) => Promise<string>;
  capture: CaptureFn;
  warn: (message: string) => void;
  /**
   * Capture progress, so a long pass isn't silent. `total` counts the screens
   * plus the boards with frames; skipped and failed shots still advance `done`,
   * since it tracks work completed rather than files produced.
   */
  progress?: (done: number, total: number) => void;
  /** Test/benchmark seam; production follows the renderer's process-wide cap. */
  concurrency?: number;
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
  const selectedScreens = opts.screenIds
    ? screens.filter((screen) => opts.screenIds?.has(screen.id))
    : screens;
  const selectedBoards = opts.boardIds
    ? boards.filter((board) => opts.boardIds?.has(board.id))
    : boards;
  const manifest: ScreenshotManifest = { cover: "", screens: {}, boards: {} };
  const total =
    selectedScreens.length + selectedBoards.filter((board) => board.frames.length > 0).length;
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

  type Shot = { kind: "screen" | "board"; id: string; path: string; bytes: Uint8Array };
  type Job = { run(): Promise<Shot | null> };
  const jobs: Job[] = [];
  for (const screen of selectedScreens) {
    jobs.push({
      run: async () => {
        try {
          const png = await shoot(await renderHtml(screen), viewport, true);
          if (!png) {
            warn(`screenshot of screen "${screen.id}" exceeds 4MB even downscaled — skipped`);
            return null;
          }
          return {
            kind: "screen",
            id: screen.id,
            path: `screenshots/${screen.id}.png`,
            bytes: png,
          };
        } catch (err) {
          if (isBrowserMissing(err)) throw err;
          warn(`screenshot of screen "${screen.id}" failed — skipped (${message(err)})`);
          return null;
        } finally {
          advance();
        }
      },
    });
  }

  const screenById = new Map(screens.map((screen) => [screen.id, screen]));
  for (const board of selectedBoards) {
    if (board.frames.length === 0) continue;
    jobs.push({
      run: async () => {
        try {
          const framed = (
            await Promise.all(
              board.frames.map(async (frame): Promise<{ frame: Frame; html: string } | null> => {
                const screen = screenById.get(frame.screen);
                return screen
                  ? { frame, html: await renderHtml(screen, board.theme, frame.scheme ?? "light") }
                  : null;
              }),
            )
          ).filter((entry): entry is { frame: Frame; html: string } => entry !== null);
          if (framed.length === 0) return null;
          const composite = buildBoardComposite(framed);
          const png = await shoot(composite.html, composite.viewport, false);
          if (!png) {
            warn(`screenshot of board "${board.id}" exceeds 4MB even downscaled — skipped`);
            return null;
          }
          return {
            kind: "board",
            id: board.id,
            path: `screenshots/${board.id}.png`,
            bytes: png,
          };
        } catch (err) {
          if (isBrowserMissing(err)) throw err;
          warn(`screenshot of board "${board.id}" failed — skipped (${message(err)})`);
          return null;
        } finally {
          advance();
        }
      },
    });
  }

  // Reserve a result slot before starting each job. A failed job releases its
  // reservation so another queued shot can use the cloud's 120-file budget;
  // concurrent successes can therefore never overshoot it.
  const shotLimit = MAX_SCREENSHOT_COUNT - 1; // one byte-copy slot for the cover
  const results: Array<Shot | null> = Array.from({ length: jobs.length }, () => null);
  let nextJob = 0;
  let completedShots = 0;
  let reservedShots = 0;
  let browserMissing = false;
  const worker = async (): Promise<void> => {
    while (!browserMissing && nextJob < jobs.length && completedShots + reservedShots < shotLimit) {
      const index = nextJob++;
      reservedShots += 1;
      try {
        const shot = await jobs[index]?.run();
        if (shot) {
          results[index] = shot;
          completedShots += 1;
        }
      } catch (err) {
        if (isBrowserMissing(err)) browserMissing = true;
        else throw err;
      } finally {
        reservedShots -= 1;
      }
    }
  };
  const concurrency = Math.max(
    1,
    Math.min(MAX_CONCURRENT_RENDERS, Math.floor(opts.concurrency ?? MAX_CONCURRENT_RENDERS)),
  );
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
  if (browserMissing) {
    warn("no headless browser available — publishing without screenshots");
    return null;
  }
  if (nextJob < jobs.length) {
    warn(`screenshot limit (${MAX_SCREENSHOT_COUNT}) reached — remaining shots skipped`);
  }

  const files: Array<{ path: string; bytes: Uint8Array }> = [];
  for (const shot of results) {
    if (!shot) continue;
    files.push({ path: shot.path, bytes: shot.bytes });
    if (shot.kind === "screen") manifest.screens[shot.id] = shot.path;
    else manifest.boards[shot.id] = shot.path;
  }

  // Cover: the first board shot, or the first screen shot.
  const coverSource =
    selectedBoards.map((b) => manifest.boards[b.id]).find((p) => p !== undefined) ??
    selectedScreens.map((s) => manifest.screens[s.id]).find((p) => p !== undefined);
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
