import type { Viewport } from "@velloo/schema";
import type { Page } from "playwright-core";
import { CAPTURE_TIMEOUT_MS, withContext } from "./browser-pool.ts";
import { type DomExtract, extractDom } from "./capture-page.ts";
import { missingHostStylesheets, settleForCapture } from "./capture-settle.ts";

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
  /** Host stylesheets the page links whose stored copy didn't load. */
  missingHostStylesheets?: string[];
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

/**
 * Load a rendered document into a capture page. A document whose `<base>` names
 * the local daemon is served *from* that origin (the navigation is answered
 * in-process, everything else goes to the daemon), so the page is what a canvas
 * frame is: app code that reads `localStorage` or `location.host` while its
 * module loads would otherwise throw under `setContent`'s opaque origin and
 * silently cost the whole client mount. Anything else keeps `setContent`.
 */
async function openDocument(page: Page, html: string): Promise<void> {
  const base = /<base href="(http:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?)\/?"/.exec(
    html,
  )?.[1];
  if (!base) {
    await page.setContent(html, { waitUntil: "domcontentloaded", timeout: CAPTURE_TIMEOUT_MS });
    return;
  }
  const url = `${base}/__velloo_capture/${crypto.randomUUID()}`;
  await page.route(url, (route) =>
    route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: html }),
  );
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: CAPTURE_TIMEOUT_MS });
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
      await openDocument(page, opts.html);
      await settleForCapture(page);
      // Runtime reports (a component that threw, the stylesheet probe) land a
      // frame after ready; give them that frame.
      await page.waitForTimeout(150);
      const state = (await canvasMountState(page)) ?? { mounted: false, diagnostics: [] };
      return { ...state, consoleErrors: consoleErrors.slice(0, 20) };
    },
  );
}

/**
 * A rendered document after its client mount, frozen as static HTML: what the
 * browser is showing, with nothing left that runs. This is how a scriptless
 * export gets the app's own components — they need a browser to exist at all,
 * so one draws them and the result is kept as markup.
 *
 * `mounted` is false when the client mount didn't take; the HTML is then the
 * server render the page fell back to.
 *
 * `head` and `body` are the same page in the two pieces a share viewer needs:
 * the stylesheets, in cascade order, and the body's markup with every
 * `data-node-path` still on it — a published screen has to be the canvas's
 * DOM exactly, and comments anchor to those paths. `html` is the document for
 * a file handed to someone: the editor's markers serve nobody there.
 */
export async function captureMountedDocument(opts: {
  html: string;
  viewport: Viewport;
}): Promise<{ html: string; head: string; body: string; canvas?: CanvasMountState }> {
  return withContext(
    { viewport: { width: opts.viewport.w, height: opts.viewport.h }, deviceScaleFactor: 1 },
    async (context) => {
      const page = await context.newPage();
      await openDocument(page, opts.html);
      await settleForCapture(page);
      const canvas = await canvasMountState(page);
      const frozen = await page.evaluate(() => {
        // CSS-in-JS writes its rules through the CSSOM in production, so the
        // <style> it owns is empty in markup: spell the rules back into it.
        const cssOf = (sheet: CSSStyleSheet): string => {
          try {
            return [...sheet.cssRules].map((rule) => rule.cssText).join("\n");
          } catch {
            return "";
          }
        };
        for (const style of document.querySelectorAll("style")) {
          if ((style.textContent ?? "").trim() === "" && style.sheet) {
            style.textContent = cssOf(style.sheet);
          }
        }
        for (const sheet of document.adoptedStyleSheets ?? []) {
          const style = document.createElement("style");
          style.textContent = cssOf(sheet);
          document.head.append(style);
        }
        // The server render the mount replaced is still in the page, hidden.
        const ssr = document.getElementById("velloo-ssr");
        if (ssr && ssr.style.display === "none") ssr.remove();
        for (const el of document.querySelectorAll("script, base, link[rel='modulepreload']")) {
          el.remove();
        }
        // What a control shows is a property; markup only keeps attributes.
        for (const input of document.querySelectorAll("input")) {
          if (input.type === "checkbox" || input.type === "radio") {
            input.toggleAttribute("checked", input.checked);
          } else if (input.type !== "file" && input.type !== "password") {
            input.setAttribute("value", input.value);
          }
        }
        for (const area of document.querySelectorAll("textarea")) area.textContent = area.value;
        for (const option of document.querySelectorAll("option")) {
          option.toggleAttribute("selected", option.selected);
        }
        const head = [...document.head.querySelectorAll("style, link[rel='stylesheet']")]
          .map((el) => el.outerHTML)
          .join("\n");
        const body = document.body.innerHTML;
        for (const el of document.querySelectorAll(
          "template[data-velloo-anchor], style[data-velloo-pointer]",
        )) {
          el.remove();
        }
        return { html: `<!doctype html>\n${document.documentElement.outerHTML}`, head, body };
      });
      return { ...frozen, ...(canvas ? { canvas } : {}) };
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
  opts: Omit<ScreenshotOptions, "outPath" | "clipSelector"> & {
    dom?: boolean;
  },
): Promise<CaptureResult> {
  return withContext(
    {
      viewport: { width: opts.viewport.w, height: opts.viewport.h },
      deviceScaleFactor: opts.deviceScaleFactor ?? 1,
    },
    async (context) => {
      const page = await context.newPage();
      await openDocument(page, opts.html);
      await settleForCapture(page);
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
      const missing = await missingHostStylesheets(page, opts.html);
      return {
        png,
        nodeRects,
        ...(dom ? { dom } : {}),
        ...(canvas ? { canvas } : {}),
        ...(missing?.length ? { missingHostStylesheets: missing } : {}),
      };
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
      await openDocument(page, opts.html);
      // Bounded settle: load event, webfonts, client mounts (see settleForCapture).
      await settleForCapture(page);
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
      await openDocument(page, opts.html);
      await settleForCapture(page);
      return extractDom(page);
    },
  );
}
