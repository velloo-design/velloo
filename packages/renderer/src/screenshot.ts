import type { Viewport } from "@velloo/schema";

export interface ScreenshotOptions {
  html: string;
  viewport: Viewport;
  outPath: string;
  /** Device scale factor for retina-style output. */
  deviceScaleFactor?: number;
}

/**
 * Render the given HTML in a real browser via Playwright and write a PNG.
 * Playwright is loaded lazily so plain HTML rendering doesn't pull it in.
 */
export async function screenshot(opts: ScreenshotOptions): Promise<string> {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport: { width: opts.viewport.w, height: opts.viewport.h },
      deviceScaleFactor: opts.deviceScaleFactor ?? 1,
    });
    const page = await context.newPage();
    await page.setContent(opts.html, { waitUntil: "domcontentloaded" });
    await page.screenshot({ path: opts.outPath, fullPage: false });
    return opts.outPath;
  } finally {
    await browser.close();
  }
}
