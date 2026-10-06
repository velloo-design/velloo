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
  /** The page as static markup, present only when `freeze: true` was asked for. */
  frozen?: FrozenDocument;
}

/** One stylesheet of a frozen page's head: a `<style>` and its rules, or a stylesheet `<link>`. */
export interface FrozenStyle {
  tag: "style" | "link";
  /** Never a handler: nothing frozen runs. */
  attributes: Record<string, string>;
  /** A `<style>`'s rules. */
  css?: string;
}

/**
 * A rendered document after its client mount, as markup with nothing left
 * that runs.
 *
 * `head` and `body` are the page in the two pieces a share viewer needs: the
 * stylesheets, in cascade order, and the body's markup with every
 * `data-node-path` still on it — a published screen has to be the canvas's
 * DOM exactly, and comments anchor to those paths. The stylesheets come apart
 * from their markup because most of them are the same text on every screen of
 * a design, and whoever ships them should only have to ship each once. `html`
 * is the whole document for a file handed to someone: the editor's markers
 * serve nobody there.
 */
export interface FrozenDocument {
  html: string;
  head: FrozenStyle[];
  body: string;
  /** What the page's code set on `<html>` and `<body>`; handlers never travel. */
  htmlAttributes: Record<string, string>;
  bodyAttributes: Record<string, string>;
  /**
   * Whether the client mount had taken over when this was read — said by the
   * same look at the page as the markup, because a mount that lands a moment
   * later would vouch for markup taken before it. False, and this is the
   * server render the page fell back to.
   */
  mounted: boolean;
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
 * What the page is showing, as markup. It reads the live document and edits
 * only a copy of it, so it can be taken from a page that is about to be
 * photographed — or one that just was — without either changing the other:
 * a screenshot leaves traces on the elements it steadied, and a document
 * without its scripts and `<base>` is not the page that rendered.
 */
async function freezePage(page: Page): Promise<FrozenDocument> {
  return page.evaluate(() => {
    const cssOf = (sheet: CSSStyleSheet): string => {
      try {
        return [...sheet.cssRules].map((rule) => rule.cssText).join("\n");
      } catch {
        return "";
      }
    };
    const attributesOf = (el: Element): Record<string, string> =>
      Object.fromEntries(
        [...el.attributes]
          .filter((attr) => !/^on/i.test(attr.name))
          .map((attr) => [attr.name, attr.value]),
      );
    const copy = document.documentElement.cloneNode(true) as HTMLElement;
    // A copy has the markup and none of the state, so each element that holds
    // some is paired with its original — same tree, same order — before
    // anything is taken out of the copy.
    const paired = <E extends Element>(selector: string): [E, E][] => {
      const copies = [...copy.querySelectorAll<E>(selector)];
      return [...document.querySelectorAll<E>(selector)].flatMap((live, at) => {
        const twin = copies[at];
        return twin ? [[live, twin] as [E, E]] : [];
      });
    };
    // CSS-in-JS writes its rules through the CSSOM in production, so the
    // <style> it owns is empty in markup: spell the rules back into it.
    for (const [live, twin] of paired<HTMLStyleElement>("style")) {
      if ((live.textContent ?? "").trim() === "" && live.sheet) {
        twin.textContent = cssOf(live.sheet);
      }
    }
    // What a control shows is a property; markup only keeps attributes.
    for (const [live, twin] of paired<HTMLInputElement>("input")) {
      if (live.type === "checkbox" || live.type === "radio") {
        twin.toggleAttribute("checked", live.checked);
      } else if (live.type !== "file" && live.type !== "password") {
        twin.setAttribute("value", live.value);
      }
    }
    for (const [live, twin] of paired<HTMLTextAreaElement>("textarea")) {
      twin.textContent = live.value;
    }
    for (const [live, twin] of paired<HTMLOptionElement>("option")) {
      twin.toggleAttribute("selected", live.selected);
    }
    const head = copy.querySelector("head");
    for (const sheet of document.adoptedStyleSheets ?? []) {
      const style = document.createElement("style");
      style.textContent = cssOf(sheet);
      head?.append(style);
    }
    // The server render the mount replaced is still in the page, hidden.
    const ssr = document.getElementById("velloo-ssr");
    const mounted = Boolean(ssr && ssr.style.display === "none");
    if (mounted) copy.querySelector("#velloo-ssr")?.remove();
    for (const el of copy.querySelectorAll("script, base, link[rel='modulepreload']")) {
      el.remove();
    }
    const styles = [...(head?.querySelectorAll("style, link[rel='stylesheet']") ?? [])].map((el) =>
      el instanceof HTMLStyleElement
        ? { tag: "style" as const, attributes: attributesOf(el), css: el.textContent ?? "" }
        : { tag: "link" as const, attributes: attributesOf(el) },
    );
    const body = copy.querySelector("body")?.innerHTML ?? "";
    for (const el of copy.querySelectorAll(
      "template[data-velloo-anchor], style[data-velloo-pointer]",
    )) {
      el.remove();
    }
    return {
      html: `<!doctype html>\n${copy.outerHTML}`,
      head: styles,
      body,
      htmlAttributes: attributesOf(document.documentElement),
      bodyAttributes: attributesOf(document.body),
      mounted: mounted && document.getElementById("velloo-canvas-data") !== null,
    };
  });
}

/**
 * A rendered document after its client mount, frozen as static HTML: what the
 * browser is showing, with nothing left that runs. This is how a scriptless
 * export gets the app's own components — they need a browser to exist at all,
 * so one draws them and the result is kept as markup.
 *
 * `canvas` adds what the mount found, component by component.
 */
export async function captureMountedDocument(opts: {
  html: string;
  viewport: Viewport;
}): Promise<FrozenDocument & { canvas?: CanvasMountState }> {
  return withContext(
    { viewport: { width: opts.viewport.w, height: opts.viewport.h }, deviceScaleFactor: 1 },
    async (context) => {
      const page = await context.newPage();
      await openDocument(page, opts.html);
      await settleForCapture(page);
      const canvas = await canvasMountState(page);
      const frozen = await freezePage(page);
      return { ...frozen, ...(canvas ? { canvas } : {}) };
    },
  );
}

/**
 * Screenshot plus every node's bounding rect — the capture mode the
 * diff pipeline needs (rects let pixel regions map back to tree nodes).
 * Animations/caret are frozen so motion (marquees, glow pulses) doesn't
 * register as phantom diffs.
 *
 * `freeze` also returns the page as markup, from this same load: a caller
 * that wants both the picture and the DOM (publish does, for every screen the
 * canvas mounts) would otherwise mount the app's components twice to get them.
 */
export async function captureScreenshot(
  opts: Omit<ScreenshotOptions, "outPath" | "clipSelector"> & {
    dom?: boolean;
    freeze?: boolean;
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
      // Before the picture: taking it leaves marks on the page (an empty
      // `style` on a field whose caret it hid), and those are not the design.
      const frozen = opts.freeze ? await freezePage(page) : undefined;
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
        ...(frozen ? { frozen } : {}),
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
