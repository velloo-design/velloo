import type { Viewport } from "@velloo/schema";

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

async function screenshotInternal(opts: ScreenshotOptions): Promise<Buffer | null> {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport: { width: opts.viewport.w, height: opts.viewport.h },
      deviceScaleFactor: opts.deviceScaleFactor ?? 1,
    });
    const page = await context.newPage();
    await page.setContent(opts.html, { waitUntil: "domcontentloaded" });
    const fullPage = opts.fullPage ?? true;
    if (opts.outPath) {
      await page.screenshot({ path: opts.outPath, fullPage });
      return null;
    }
    const buf = await page.screenshot({ fullPage });
    return buf;
  } finally {
    await browser.close();
  }
}
