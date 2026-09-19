import type { Viewport } from "@velloo/schema";
import type { Page } from "playwright-core";
import { CAPTURE_TIMEOUT_MS, withContext } from "./browser-pool.ts";
import { type DomExtract, extractDom } from "./capture-page.ts";
import { settleForCapture } from "./capture-settle.ts";

export interface ScreenshotOptions {
  html: string;
  viewport: Viewport;
  /** Write the PNG here. Omit to get a Buffer back instead (see `screenshotBuffer`). */
  outPath?: string;
  /** Device scale factor for retina-style output. */
  deviceScaleFactor?: number;
  /**
   * Capture the full document height — not just the viewport. Defaults true so
   * tall marketing pages aren't under-screenshotted by default. Pass `false` to
   * clip to the viewport rectangle.
   */
  fullPage?: boolean;
  /**
   * Capture only the first element matching this CSS selector (e.g.
   * `[data-node-path="0.2"]`) instead of the page. Errors if absent.
   */
  clipSelector?: string;
}

/**
 * Render the given HTML in a real browser via Playwright and write a PNG.
 * Playwright is loaded lazily so plain HTML rendering doesn't pull it in.
 * Returns the file path that was written.
 */
export async function screenshot(opts: ScreenshotOptions & { outPath: string }): Promise<string> {
  await screenshotInternal(opts);
  return opts.outPath;
}

/** Like `screenshot`, but returns the PNG bytes instead of writing to disk. */
export async function screenshotBuffer(opts: Omit<ScreenshotOptions, "outPath">): Promise<Buffer> {
  const buf = await screenshotInternal(opts);
  if (!buf) throw new Error("screenshotBuffer: no buffer returned (internal invariant)");
  return buf;
}

export interface CaptureNodeRect {
  /** data-node-path attribute value (dotted; "" = root). */
  path: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CaptureResult {
  png: Buffer;
  /** Bounding rects in CSS pixels (multiply by deviceScaleFactor for image px). */
  nodeRects: CaptureNodeRect[];
  /**
   * Computed styles + geometry per element, present only when `dom: true` was
   * asked for. Measured by the same walker that reads a captured app page, so
   * the two sides of a fidelity diff are comparable property for property.
   */
  dom?: DomExtract;
  /** The client mount's outcome, when the document carried one. */
  canvas?: CanvasMountState;
}

/** What a frame's client mount did: whether it owns the screen, and per-component findings. */
export interface CanvasMountState {
  mounted: boolean;
  /** The bundle URL the page mounted — the key the daemon files runtime findings under. */
  bundle?: string;
  diagnostics: {
    id: string;
    status: string;
    name?: string;
    code?: string;
    note?: string;
    remedy?: string;
  }[];
}

async function canvasMountState(page: Page): Promise<CanvasMountState | undefined> {
  return page
    .evaluate(() => {
      const w = window as Window & {
        __velloo_canvas_diagnostics?: unknown[];
        __velloo_canvas_bundle?: string;
      };
      if (!document.getElementById("velloo-canvas-data")) return undefined;
      const ssr = document.getElementById("velloo-ssr");
      return {
        mounted: Boolean(ssr && ssr.style.display === "none"),
        ...(w.__velloo_canvas_bundle ? { bundle: w.__velloo_canvas_bundle } : {}),
        diagnostics: (w.__velloo_canvas_diagnostics ?? []) as CanvasMountState["diagnostics"],
      };
    })
    .catch(() => undefined);
}

/**
 * Mount a rendered document in a real browser and report what its client mount
 * found — the probe behind `preview_status`: a missing provider, an unstyled
 * component or a throwing preview entry only show up once something runs.
 */
export async function probeCanvasMount(opts: {
  html: string;
  viewport: Viewport;
}): Promise<CanvasMountState & { consoleErrors: string[] }> {
  return withContext(
    { viewport: { width: opts.viewport.w, height: opts.viewport.h }, deviceScaleFactor: 1 },
    async (context) => {
      const page = await context.newPage();
      const consoleErrors: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text().slice(0, 400));
      });
      page.on("pageerror", (error) => consoleErrors.push(error.message.slice(0, 400)));
      await page.setContent(opts.html, {
        waitUntil: "domcontentloaded",
        timeout: CAPTURE_TIMEOUT_MS,
      });
      await settleForCapture(page, opts.html);
      // Runtime reports (a component that threw, the stylesheet probe) land a
      // frame after ready; give them that frame.
      await page.waitForTimeout(150);
      const state = (await canvasMountState(page)) ?? { mounted: false, diagnostics: [] };
      return { ...state, consoleErrors: consoleErrors.slice(0, 20) };
    },
  );
}

/**
 * Screenshot plus every node's bounding rect — the capture mode the
 * diff pipeline needs (rects let pixel regions map back to tree nodes).
 * Animations/caret are frozen so motion (marquees, glow pulses) doesn't
 * register as phantom diffs.
 */
export async function captureScreenshot(
  opts: Omit<ScreenshotOptions, "outPath" | "clipSelector"> & { dom?: boolean },
): Promise<CaptureResult> {
  return withContext(
    {
      viewport: { width: opts.viewport.w, height: opts.viewport.h },
      deviceScaleFactor: opts.deviceScaleFactor ?? 1,
    },
    async (context) => {
      const page = await context.newPage();
      await page.setContent(opts.html, {
        waitUntil: "domcontentloaded",
        timeout: CAPTURE_TIMEOUT_MS,
      });
      await settleForCapture(page, opts.html);
      const nodeRects = await page.$$eval("[data-node-path]", (els) =>
        els.map((el) => {
          const r = el.getBoundingClientRect();
          return {
            path: (el as HTMLElement).dataset.nodePath ?? "",
            x: r.left,
            y: r.top,
            w: r.width,
            h: r.height,
          };
        }),
      );
      const png = await page.screenshot({
        fullPage: opts.fullPage ?? true,
        animations: "disabled",
        caret: "hide",
        timeout: CAPTURE_TIMEOUT_MS,
      });
      const dom = opts.dom ? await extractDom(page) : undefined;
      const canvas = await canvasMountState(page);
      return { png, nodeRects, ...(dom ? { dom } : {}), ...(canvas ? { canvas } : {}) };
    },
  );
}

async function screenshotInternal(opts: ScreenshotOptions): Promise<Buffer | null> {
  return withContext(
    {
      viewport: { width: opts.viewport.w, height: opts.viewport.h },
      deviceScaleFactor: opts.deviceScaleFactor ?? 1,
    },
    async (context) => {
      const page = await context.newPage();
      await page.setContent(opts.html, {
        waitUntil: "domcontentloaded",
        timeout: CAPTURE_TIMEOUT_MS,
      });
      // Bounded settle: load event, webfonts, live islands (see settleForCapture).
      await settleForCapture(page, opts.html);
      if (opts.clipSelector) {
        const locator = page.locator(opts.clipSelector).first();
        if ((await locator.count()) === 0) {
          throw new Error(`screenshot: no element matches selector ${opts.clipSelector}`);
        }
        if (opts.outPath) {
          await locator.screenshot({ path: opts.outPath, timeout: CAPTURE_TIMEOUT_MS });
          return null;
        }
        return await locator.screenshot({ timeout: CAPTURE_TIMEOUT_MS });
      }
      const fullPage = opts.fullPage ?? true;
      if (opts.outPath) {
        await page.screenshot({ path: opts.outPath, fullPage, timeout: CAPTURE_TIMEOUT_MS });
        return null;
      }
      const buf = await page.screenshot({ fullPage, timeout: CAPTURE_TIMEOUT_MS });
      return buf;
    },
  );
}

/**
 * Measure a Velloo render in a real browser: every visible element's geometry
 * and computed styles, keyed back to the design node that produced it.
 *
 * The SSR path can say which component rendered but not what it rendered *as* —
 * whether a `size="xl"` button actually got a height, whether one utility class
 * lost to another in the cascade. Those are facts only a browser holds, and
 * predicting them from class strings is exactly the fragile reasoning this
 * removes. No screenshot is taken: the caller wants the numbers.
 */
export async function measureRendered(opts: {
  html: string;
  viewport: Viewport;
}): Promise<DomExtract> {
  return withContext(
    { viewport: { width: opts.viewport.w, height: opts.viewport.h }, deviceScaleFactor: 1 },
    async (context) => {
      const page = await context.newPage();
      await page.setContent(opts.html, {
        waitUntil: "domcontentloaded",
        timeout: CAPTURE_TIMEOUT_MS,
      });
      await settleForCapture(page, opts.html);
      return extractDom(page);
    },
  );
}
