import { existsSync } from "node:fs";
import type { Viewport } from "@velloo/schema";
import type { Browser } from "playwright-core";

/** The command that installs the headless browser screenshots need. */
export const CHROMIUM_INSTALL_CMD = "bunx playwright install chromium";

const INSTALL_HINT =
  "Velloo screenshots need a headless browser. Install it once with:\n" +
  `  ${CHROMIUM_INSTALL_CMD}\n` +
  "(The browser is an on-demand extra — the canvas itself never needs it.)";

/**
 * Thrown when the headless browser is unavailable — either `playwright-core`
 * is missing or its Chromium binary hasn't been installed. Callers with a TTY
 * (the CLI) can catch this, offer to run `CHROMIUM_INSTALL_CMD`, and retry;
 * agent-facing callers (MCP) surface `.message` as the actionable hint.
 */
export class BrowserMissingError extends Error {
  constructor(message = INSTALL_HINT) {
    super(message);
    this.name = "BrowserMissingError";
  }
}

/**
 * Absolute path to the installed Chromium, or null if its binary hasn't been
 * downloaded yet (or `playwright-core` is absent). A non-launching probe —
 * cheap enough for `velloo init` to report screenshot readiness without
 * opening a browser.
 */
export async function chromiumExecutable(): Promise<string | null> {
  try {
    const { chromium } = await import("playwright-core");
    const path = chromium.executablePath();
    return path && existsSync(path) ? path : null;
  } catch {
    return null;
  }
}

/**
 * Launch headless Chromium via `playwright-core`. We depend on
 * `playwright-core` (no bundled-browser postinstall) instead of `playwright`
 * so installing the CLI stays light; the browser is fetched on demand into
 * the shared Playwright cache and reused here. Both the missing-package and
 * missing-browser failures collapse into one actionable hint.
 */
async function launchBrowser(): Promise<Browser> {
  let chromium: typeof import("playwright-core").chromium;
  try {
    ({ chromium } = await import("playwright-core"));
  } catch {
    throw new BrowserMissingError();
  }
  try {
    return await chromium.launch();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/Executable doesn't exist|playwright install|browserType\.launch/i.test(msg)) {
      throw new BrowserMissingError();
    }
    throw e;
  }
}

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
}

/**
 * Screenshot plus every node's bounding rect — the capture mode the
 * diff pipeline needs (rects let pixel regions map back to tree nodes).
 * Animations/caret are frozen so motion (marquees, glow pulses) doesn't
 * register as phantom diffs.
 */
export async function captureScreenshot(
  opts: Omit<ScreenshotOptions, "outPath" | "clipSelector">,
): Promise<CaptureResult> {
  const browser = await launchBrowser();
  try {
    const context = await browser.newContext({
      viewport: { width: opts.viewport.w, height: opts.viewport.h },
      deviceScaleFactor: opts.deviceScaleFactor ?? 1,
    });
    const page = await context.newPage();
    await page.setContent(opts.html, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("load", { timeout: 5000 }).catch(() => {});
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
    });
    return { png, nodeRects };
  } finally {
    await browser.close();
  }
}

export interface UrlScreenshotOptions {
  url: string;
  viewport: Viewport;
  deviceScaleFactor?: number;
  fullPage?: boolean;
  /** Bounded wait for network quiet before capture, ms. Default 8000. */
  settleTimeoutMs?: number;
  /**
   * Drive the target page into dark mode before capture so a Velloo dark
   * render diffs against the app's actual dark theme (not its light default).
   * Best-effort across the common toggles: emulates `prefers-color-scheme:
   * dark`, seeds `localStorage.theme = "dark"` before any script runs (covers
   * next-themes' default), and after load adds the `.dark` class +
   * `data-theme="dark"` to `<html>` (covers class-strategy Tailwind). An app
   * with a bespoke theme mechanism may not flip — verify the capture.
   */
  dark?: boolean;
}

/**
 * Screenshot a live URL (typically the host app on localhost) — the
 * code-to-design counterpart of `captureScreenshot`. Animations and caret
 * are frozen so the capture diffs cleanly against a Velloo render.
 */
export async function captureUrlScreenshot(opts: UrlScreenshotOptions): Promise<Buffer> {
  const browser = await launchBrowser();
  try {
    const context = await browser.newContext({
      viewport: { width: opts.viewport.w, height: opts.viewport.h },
      deviceScaleFactor: opts.deviceScaleFactor ?? 1,
      ...(opts.dark ? { colorScheme: "dark" as const } : {}),
    });
    if (opts.dark) {
      // Seed before any page script runs so localStorage-driven togglers
      // (next-themes &c.) read "dark" on first paint instead of flashing light.
      await context.addInitScript(() => {
        try {
          localStorage.setItem("theme", "dark");
        } catch {}
      });
    }
    const page = await context.newPage();
    await page.goto(opts.url, { waitUntil: "domcontentloaded", timeout: 15000 });
    if (opts.dark) {
      // Class-strategy Tailwind (shadcn's default) keys off `.dark` on the
      // root; some apps read `data-theme`. Set both — harmless if unused.
      await page
        .evaluate(() => {
          const el = document.documentElement;
          el.classList.add("dark");
          el.setAttribute("data-theme", "dark");
          el.style.colorScheme = "dark";
        })
        .catch(() => {});
    }
    await page
      .waitForLoadState("networkidle", { timeout: opts.settleTimeoutMs ?? 8000 })
      .catch(() => {});
    return await page.screenshot({
      fullPage: opts.fullPage ?? true,
      animations: "disabled",
      caret: "hide",
    });
  } finally {
    await browser.close();
  }
}

async function screenshotInternal(opts: ScreenshotOptions): Promise<Buffer | null> {
  const browser = await launchBrowser();
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
    if (opts.clipSelector) {
      const locator = page.locator(opts.clipSelector).first();
      if ((await locator.count()) === 0) {
        throw new Error(`screenshot: no element matches selector ${opts.clipSelector}`);
      }
      if (opts.outPath) {
        await locator.screenshot({ path: opts.outPath });
        return null;
      }
      return await locator.screenshot();
    }
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
  const labelLeft = opts.leftLabel ?? "light";
  const labelRight = opts.rightLabel ?? "dark";
  const w = opts.viewport.w;
  const h = opts.viewport.h;
  const wrapper = buildCompareWrapper(opts.leftHtml, opts.rightHtml, w, h, labelLeft, labelRight);
  const browser = await launchBrowser();
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
  panelHeight: number,
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
  // Each iframe starts at the requested viewport height — never measure
  // from the 150px iframe default, because viewport-bound layouts
  // (h-screen roots) size themselves to whatever the iframe is, so the
  // scrollHeight probe would just read the default back and "confirm"
  // a sliver. Grow only when content genuinely overflows the viewport.
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>${styles}</style></head>
<body>
  <div class="row">
    <div class="panel">
      <div class="label">${esc(leftLabel)}</div>
      <iframe id="L" width="${panelWidth}" height="${panelHeight}" srcdoc="${esc(leftHtml)}"></iframe>
    </div>
    <div class="panel">
      <div class="label">${esc(rightLabel)}</div>
      <iframe id="R" width="${panelWidth}" height="${panelHeight}" srcdoc="${esc(rightHtml)}"></iframe>
    </div>
  </div>
  <script>
    function size(id) {
      const f = document.getElementById(id);
      f.addEventListener("load", () => {
        const doc = f.contentDocument;
        if (!doc) { f.dataset.ready = "1"; return; }
        const h = Math.max(${panelHeight}, doc.documentElement.scrollHeight);
        f.height = String(h);
        f.dataset.ready = "1";
      });
    }
    size("L"); size("R");
  </script>
</body></html>`;
}
