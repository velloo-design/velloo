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
    // Give network images a bounded chance to land — otherwise every
    // remote <img> screenshots as a blank box and the agent's visual
    // QA loop is blind to imagery. Offline/slow assets just time out
    // and the capture proceeds.
    await page.waitForLoadState("load", { timeout: 5000 }).catch(() => {});
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

export interface ScreenshotCompareOptions {
  /** Full HTML doc for the left half (typically light mode). */
  leftHtml: string;
  /** Full HTML doc for the right half (typically dark mode). */
  rightHtml: string;
  viewport: Viewport;
  deviceScaleFactor?: number;
  /** Optional labels rendered above each half. Defaults to "light" / "dark". */
  leftLabel?: string;
  rightLabel?: string;
}

/**
 * Side-by-side render of two HTML docs in a single PNG. Each half is an
 * iframe sized to the variant viewport; the wrapper auto-grows to the
 * taller of the two. Used by the `screenshot mode: "compare"` MCP tool
 * so an agent can verify dark-mode adaptation at a glance without
 * eyeballing two separate PNGs.
 */
export async function screenshotCompareBuffer(opts: ScreenshotCompareOptions): Promise<Buffer> {
  const { chromium } = await import("playwright");
  const labelLeft = opts.leftLabel ?? "light";
  const labelRight = opts.rightLabel ?? "dark";
  const w = opts.viewport.w;
  const wrapper = buildCompareWrapper(opts.leftHtml, opts.rightHtml, w, labelLeft, labelRight);
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      // Width = 2 panels + 1px gutter + horizontal padding; arbitrary tall
      // initial height — we screenshot fullPage so the wrapper grows.
      viewport: { width: w * 2 + 24, height: 800 },
      deviceScaleFactor: opts.deviceScaleFactor ?? 1,
    });
    const page = await context.newPage();
    await page.setContent(wrapper, { waitUntil: "domcontentloaded" });
    // Wait until both iframes have measured + the wrapper sized itself.
    await page.waitForFunction(() => {
      const l = document.getElementById("L") as HTMLIFrameElement | null;
      const r = document.getElementById("R") as HTMLIFrameElement | null;
      return !!(l && r && l.dataset.ready === "1" && r.dataset.ready === "1");
    });
    // Bounded grace for network images (see screenshotInternal).
    await page.waitForLoadState("load", { timeout: 5000 }).catch(() => {});
    return await page.screenshot({ fullPage: true });
  } finally {
    await browser.close();
  }
}

function buildCompareWrapper(
  leftHtml: string,
  rightHtml: string,
  panelWidth: number,
  leftLabel: string,
  rightLabel: string,
): string {
  // Escape srcdoc payloads — the HTML may contain double quotes.
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const styles = [
    "*{box-sizing:border-box}",
    "body{margin:0;padding:8px;background:#f4f4f5;font-family:ui-sans-serif,system-ui,sans-serif;color:#27272a}",
    ".row{display:flex;gap:8px;align-items:flex-start}",
    ".panel{display:flex;flex-direction:column;gap:4px}",
    ".label{font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:#71717a}",
    "iframe{border:1px solid #e4e4e7;background:#fff;display:block}",
  ].join("");
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>${styles}</style></head>
<body>
  <div class="row">
    <div class="panel">
      <div class="label">${esc(leftLabel)}</div>
      <iframe id="L" width="${panelWidth}" srcdoc="${esc(leftHtml)}"></iframe>
    </div>
    <div class="panel">
      <div class="label">${esc(rightLabel)}</div>
      <iframe id="R" width="${panelWidth}" srcdoc="${esc(rightHtml)}"></iframe>
    </div>
  </div>
  <script>
    function size(id) {
      const f = document.getElementById(id);
      f.addEventListener("load", () => {
        const doc = f.contentDocument;
        if (!doc) { f.dataset.ready = "1"; return; }
        const h = doc.documentElement.scrollHeight;
        f.height = String(h);
        f.dataset.ready = "1";
      });
    }
    size("L"); size("R");
  </script>
</body></html>`;
}
