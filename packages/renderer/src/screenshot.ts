import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Viewport } from "@velloo/schema";
import type { Browser, BrowserContext, Frame, Page } from "playwright-core";

/** Flags the injected live/canvas runtimes set on the rendered page's window. */
type VellooReadyFlags = {
  __velloo_live_ready?: boolean;
  __velloo_canvas_ready?: boolean;
};

/**
 * When the doc carries live-island markers, wait for the client mount to
 * settle (`window.__velloo_live_ready`) so the capture lands the real
 * component's final frame, not the SSR skeleton. The runtime flips the flag
 * once every island has mounted/fallen back AND its subtree stops mutating
 * (chart entry animations finished) — so the ceiling here must clear that
 * quiescence budget (LIVE_RUNTIME's DEADLINE_MS). Still bounded — a stuck
 * bundle can't stall the shot. No-op when there are no live nodes (cheap
 * string probe avoids a pointless wait on every plain screenshot).
 *
 * Takes a `Frame` too: composite captures (the PDF deck) render each entry in
 * a same-origin iframe, so the flags live on the child frame's window.
 */
async function waitForLiveIslands(target: Page | Frame, html: string): Promise<void> {
  if (html.includes("data-live-node")) {
    await target
      .waitForFunction(
        () => (window as Window & VellooReadyFlags).__velloo_live_ready === true,
        undefined,
        { timeout: 6000 },
      )
      .catch(() => {});
  }
  // The framework-native canvas mount (#18): wait for the installed-component
  // mount (or its SSR fallback) to settle before capturing. The runtime flips
  // `__velloo_canvas_ready` on success OR fallback, so this never stalls the shot.
  if (html.includes("velloo-canvas-data")) {
    await target
      .waitForFunction(
        () => (window as Window & VellooReadyFlags).__velloo_canvas_ready === true,
        undefined,
        { timeout: 6000 },
      )
      .catch(() => {});
  }
}

/** Bounded webfont wait — Google Fonts `<link>` loads lazily, and a slow/offline
 *  font must not stall the shot. Works on a child frame too (the deck wrapper). */
async function waitForFonts(target: Page | Frame): Promise<void> {
  await target
    .evaluate(() => Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 2000))]))
    .catch(() => {});
}

/**
 * Wait for a freshly set-content page to be ready to rasterize: the load event,
 * webfonts, and any live islands. Shared by every capture path so they don't
 * drift — a missing fonts wait previously froze the fallback face on the
 * single-shot + compare paths. Pass `liveIslands: false` for composite pages
 * whose islands live in child frames, not the top document (the compare and
 * PDF-deck wrappers).
 */
async function settleForCapture(
  page: Page,
  html: string,
  opts: { liveIslands?: boolean } = {},
): Promise<void> {
  await page.waitForLoadState("load", { timeout: 5000 }).catch(() => {});
  await waitForFonts(page);
  if (opts.liveIslands !== false) await waitForLiveIslands(page, html);
}

/**
 * The command that installs the headless browser screenshots need. Pinned to
 * the same version as the `playwright` / `playwright-core` devDeps in this
 * package's package.json: an unpinned `bunx playwright install` resolves the
 * latest CLI and downloads a Chromium revision that the pinned runtime then
 * refuses to launch. Bump both together.
 *
 * `--only-shell` fetches just the chromium-headless-shell build (~110MB
 * download) instead of shell + full Chrome for Testing (~300MB) — velloo only
 * ever launches headless, and playwright's headless launches use the shell.
 */
const PLAYWRIGHT_PIN = "playwright@1.61.1";
export const CHROMIUM_INSTALL_ARGV = [
  "bunx",
  PLAYWRIGHT_PIN,
  "install",
  "chromium",
  "--only-shell",
] as const;
export const CHROMIUM_INSTALL_CMD = CHROMIUM_INSTALL_ARGV.join(" ");

/**
 * Linux only: the browser download can succeed while the host is missing the
 * shared libraries Chromium links against (playwright prints its "Host system
 * is missing dependencies" box but still exits 0). This installs them via the
 * distro package manager — needs root/sudo.
 */
export const CHROMIUM_DEPS_INSTALL_ARGV = [
  "bunx",
  PLAYWRIGHT_PIN,
  "install-deps",
  "chromium",
] as const;
export const CHROMIUM_DEPS_INSTALL_CMD = CHROMIUM_DEPS_INSTALL_ARGV.join(" ");

const INSTALL_HINT =
  "Velloo screenshots need a headless browser. Install it once with:\n" +
  `  ${CHROMIUM_INSTALL_CMD}\n` +
  "Then just retry the tool — the browser is picked up on the next call, no server restart needed. " +
  "(It's an on-demand extra; the canvas itself never needs it.)";

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
 *
 * Accepts either the full Chrome for Testing build or the headless-shell-only
 * layout our `--only-shell` install produces. `chromium.executablePath()`
 * only knows the full build (the `channel` option is ignored there), so the
 * shell is probed by directory shape: `chromium-<rev>` ⇒
 * `chromium_headless_shell-<rev>/<platform-dir>/chrome-headless-shell[.exe]`.
 * Headless launches use the shell natively, so finding it means ready.
 */
export async function chromiumExecutable(): Promise<string | null> {
  try {
    const { chromium } = await import("playwright-core");
    const path = chromium.executablePath();
    if (!path) return null;
    if (existsSync(path)) return path;
    const m = path.match(/^(.*)[/\\]chromium-(\d+)[/\\]/);
    if (!m || !m[1] || !m[2]) return null;
    const shellRoot = join(m[1], `chromium_headless_shell-${m[2]}`);
    if (!existsSync(shellRoot)) return null;
    const bin =
      process.platform === "win32" ? "chrome-headless-shell.exe" : "chrome-headless-shell";
    for (const sub of readdirSync(shellRoot)) {
      const candidate = join(shellRoot, sub, bin);
      if (existsSync(candidate)) return candidate;
    }
    return null;
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
    // Any other launch failure (missing system libs, version skew, sandbox):
    // Playwright dumps ~40 lines of browser log. Collapse it to a one-line
    // summary + the install hint as the most likely fix — agents (and humans)
    // get something actionable instead of a wall of stderr.
    const firstLine =
      msg
        .split("\n")
        .find((l) => l.trim() !== "")
        ?.trim() ?? msg;
    throw new BrowserMissingError(
      `Chromium failed to launch: ${firstLine}\nIf the browser isn't installed, run:\n  ${CHROMIUM_INSTALL_CMD}\nThen retry — no server restart needed.`,
    );
  }
}

/**
 * Cap on concurrent browser renders, process-wide (so it bounds every agent
 * sharing the daemon). Renders now share one pooled Chromium (see `withContext`),
 * so each concurrent slot is a cheap browser *context*, not a whole process — the
 * spawn spike that used to stall the daemon is gone. Kept modest so a burst of
 * tall captures still can't peg CPU.
 */
const MAX_CONCURRENT_RENDERS = 3;

let renderSlots = MAX_CONCURRENT_RENDERS;
const renderQueue: Array<() => void> = [];

/**
 * Acquire a render slot, waiting in line if all are taken. Returns an idempotent
 * release that hands the slot straight to the next waiter, so it's never lost.
 */
async function acquireRenderSlot(): Promise<() => void> {
  if (renderSlots > 0) {
    renderSlots -= 1;
  } else {
    await new Promise<void>((resolve) => renderQueue.push(resolve));
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = renderQueue.shift();
    if (next) next();
    else renderSlots += 1;
  };
}

/**
 * One warm Chromium, reused across captures. Launching a browser costs hundreds
 * of ms + a process spawn; a fresh BrowserContext costs ~ms and is fully isolated
 * — so we pay the launch once and hand each capture its own context. Launched
 * lazily and dropped if it dies, so the next call relaunches; Playwright kills the
 * child on process exit, so daemon shutdown is covered.
 */
let pooledBrowser: Browser | null = null;
let browserLaunch: Promise<Browser> | null = null;

/**
 * Close the shared Chromium and forget it. The long-lived daemon never needs
 * this (Playwright kills the child on process exit) — but a one-shot CLI
 * command (`velloo publish`, `velloo render`) must release it once its
 * captures are done, or the open browser connection keeps the process's event
 * loop alive after the work has finished. Safe to call with nothing pooled;
 * the next capture simply relaunches.
 */
export async function closePooledBrowser(): Promise<void> {
  const browser = pooledBrowser ?? (browserLaunch ? await browserLaunch.catch(() => null) : null);
  pooledBrowser = null;
  await browser?.close().catch(() => undefined);
}

async function pooledChromium(): Promise<Browser> {
  if (pooledBrowser?.isConnected()) return pooledBrowser;
  // Coalesce concurrent first-launches so a burst doesn't spawn N browsers.
  if (!browserLaunch) {
    browserLaunch = launchBrowser()
      .then((b) => {
        pooledBrowser = b;
        b.on("disconnected", () => {
          if (pooledBrowser === b) pooledBrowser = null;
        });
        return b;
      })
      .finally(() => {
        browserLaunch = null;
      });
  }
  return browserLaunch;
}

/** Playwright's "the browser/context/page died under us" errors — the cue to drop
 *  the pooled browser and retry once instead of failing the capture. */
function isBrowserGone(err: unknown): boolean {
  const m = err instanceof Error ? err.message : String(err);
  return /has been closed|Target closed|browser closed|Connection closed|crashed/i.test(m);
}

/**
 * Run `fn` with a fresh isolated context from the pooled browser, under the
 * concurrency cap. Always closes the context (never the shared browser); if the
 * pooled browser died, relaunches and retries once so a crash isn't user-facing.
 * The single chokepoint every capture path funnels through.
 */
async function withContext<T>(
  options: Parameters<Browser["newContext"]>[0],
  fn: (context: BrowserContext) => Promise<T>,
): Promise<T> {
  const release = await acquireRenderSlot();
  try {
    return await runInContext(options, fn);
  } catch (err) {
    if (!isBrowserGone(err)) throw err;
    pooledBrowser = null; // force a relaunch, then a single retry
    return await runInContext(options, fn);
  } finally {
    release();
  }
}

async function runInContext<T>(
  options: Parameters<Browser["newContext"]>[0],
  fn: (context: BrowserContext) => Promise<T>,
): Promise<T> {
  const browser = await pooledChromium();
  const context = await browser.newContext(options);
  try {
    return await fn(context);
  } finally {
    await context.close().catch(() => undefined);
  }
}

/**
 * Upper bound on a single rasterize / setContent step. Playwright defaults to
 * 30s; we cap lower so a one-off render stall (a cold web-font fetch, a very
 * expensive paint) fails fast with an actionable message and frees the browser
 * process — instead of pinning it, and contending with the next capture, for
 * the full default. Generous vs. a normal full-page shot (<2s); see
 * `isCaptureTimeout` for the caller-facing message.
 */
const CAPTURE_TIMEOUT_MS = 20_000;

/**
 * True for a Playwright timeout thrown by a capture step. Lets MCP callers
 * turn an opaque `TimeoutError` into an actionable hint rather than surfacing
 * the raw "Timeout 20000ms exceeded" line.
 */
export function isCaptureTimeout(err: unknown): boolean {
  return err instanceof Error && err.name === "TimeoutError";
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
      return { png, nodeRects };
    },
  );
}

/** A cookie to seed before navigating — Playwright's `addCookies` shape, trimmed. */
export interface UrlCookie {
  name: string;
  value: string;
  /** Either `url` OR `domain`+`path` is required (Playwright's rule). */
  url?: string;
  domain?: string;
  path?: string;
}

export interface UrlCaptureResult {
  png: Buffer;
  /** Where the page actually landed after redirects — compare to the requested URL. */
  finalUrl: string;
  /** A password field is present — a strong signal the capture hit a login wall. */
  authWall: boolean;
  /**
   * Non-null when the capture doesn't look like a real page render — a dev
   * error overlay, an error page, or a blank document. The diff is then
   * against a broken target, not the design, so similarity is meaningless.
   */
  pageError: string | null;
}

export interface UrlScreenshotOptions {
  url: string;
  viewport: Viewport;
  deviceScaleFactor?: number;
  fullPage?: boolean;
  /** Bounded wait for network quiet before capture, ms. Default 8000. */
  settleTimeoutMs?: number;
  /**
   * Inject an authenticated session so auth-gated pages capture the real page
   * instead of a login redirect. `storageStatePath` points at a Playwright
   * storage-state JSON (cookies + origin localStorage in one file — the robust
   * path; produce it once with `playwright codegen`/a login script). `cookies`
   * and `localStorage` are simpler one-offs layered on top.
   */
  storageStatePath?: string;
  cookies?: UrlCookie[];
  localStorage?: Record<string, string>;
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
export async function captureUrlScreenshot(opts: UrlScreenshotOptions): Promise<UrlCaptureResult> {
  return withContext(
    {
      viewport: { width: opts.viewport.w, height: opts.viewport.h },
      deviceScaleFactor: opts.deviceScaleFactor ?? 1,
      ...(opts.dark ? { colorScheme: "dark" as const } : {}),
      ...(opts.storageStatePath ? { storageState: opts.storageStatePath } : {}),
    },
    async (context) => {
      if (opts.cookies && opts.cookies.length > 0) {
        await context.addCookies(opts.cookies);
      }
      if (opts.localStorage && Object.keys(opts.localStorage).length > 0) {
        await context.addInitScript((entries: Array<[string, string]>) => {
          try {
            for (const [k, v] of entries) localStorage.setItem(k, v);
          } catch {}
        }, Object.entries(opts.localStorage));
      }
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
      // Read the landed URL + auth signal before the screenshot so the caller can
      // tell a faithful capture from one that bounced to a login page.
      const finalUrl = page.url();
      const authWall = await page
        .locator('input[type="password"]')
        .count()
        .then((n) => n > 0)
        .catch(() => false);
      // A broken target — dev error overlay, error page, blank doc — would
      // otherwise pixel-diff against the design and report a confident-but-bogus
      // low similarity blamed on the design. Detect it so the caller can say so.
      const pageError = await page
        .evaluate(() => {
          if (
            document.querySelector(
              "nextjs-portal, [data-nextjs-dialog], #__next-build-error, vite-error-overlay",
            )
          ) {
            return "the target app is showing a dev error overlay — it's throwing, so the diff isn't about your design";
          }
          const txt = (document.body?.innerText ?? "").trim();
          if (txt.length === 0) return "the target captured as a blank page (no visible text)";
          const m = txt.match(
            /Unhandled Runtime Error|Application error: a (?:client|server)-side exception|Internal Server Error|This page (?:could not be|isn't) found|Failed to compile|\b(?:Type|Syntax|Reference)Error:/i,
          );
          return m ? `the target looks like an error page ("${m[0]}")` : null;
        })
        .catch(() => null);
      const png = await page.screenshot({
        fullPage: opts.fullPage ?? true,
        animations: "disabled",
        caret: "hide",
        timeout: CAPTURE_TIMEOUT_MS,
      });
      return { png, finalUrl, authWall, pageError };
    },
  );
}

const LOGIN_PATH =
  /\/(login|signin|sign-in|auth|authenticate|account\/login|users\/sign_in)(\/|$)/i;

/**
 * Did a URL capture land where it was asked to? Compares origin + pathname
 * (trailing slash, query, and hash ignored) and flags login-looking URLs on
 * both ends. The code-to-design compare loop is blind without this: an
 * auth-gated page that redirects to `/login` would otherwise image-diff
 * against the login screen and report a confident — and meaningless —
 * similarity. `requestedLooksLikeLogin` lets the caller avoid false alarms
 * when the user is deliberately porting a login page (a password field is
 * then expected, not an auth wall).
 */
export function classifyCapture(
  requested: string,
  finalUrl: string,
): { redirected: boolean; finalLooksLikeLogin: boolean; requestedLooksLikeLogin: boolean } {
  try {
    const norm = (u: URL) => u.origin + u.pathname.replace(/\/+$/, "");
    const reqUrl = new URL(requested);
    const finUrl = new URL(finalUrl);
    return {
      redirected: norm(reqUrl) !== norm(finUrl),
      finalLooksLikeLogin: LOGIN_PATH.test(finUrl.pathname),
      requestedLooksLikeLogin: LOGIN_PATH.test(reqUrl.pathname),
    };
  } catch {
    return {
      redirected: requested !== finalUrl,
      finalLooksLikeLogin: LOGIN_PATH.test(finalUrl),
      requestedLooksLikeLogin: LOGIN_PATH.test(requested),
    };
  }
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

export interface PdfPageOptions {
  html: string;
  viewport: Viewport;
  /**
   * Grow the page to the full content height (fullPage semantics, mirroring the
   * screenshot pipeline's default) so nothing clips — every frame stays a
   * single PDF page. Pass `false` to clip at the viewport rectangle instead.
   */
  fullPage?: boolean;
  /** Small name chip overlaid bottom-left (deck pages carry the frame/screen name). */
  label?: string;
}

/**
 * Render HTML to a single-page PDF via Chromium's native `page.pdf`. Media
 * stays emulated as `screen` (print stylesheets would strip the design's
 * backgrounds) and `printBackground` is on, so the page prints exactly what
 * the screenshot path rasterizes — same settle (load + webfonts + live
 * islands), so webfonts are resolved before printing.
 */
export async function pdfPageBuffer(opts: PdfPageOptions): Promise<Buffer> {
  return withContext(
    { viewport: { width: opts.viewport.w, height: opts.viewport.h } },
    async (context) => {
      const page = await context.newPage();
      await page.emulateMedia({ media: "screen" });
      await page.setContent(opts.html, {
        waitUntil: "domcontentloaded",
        timeout: CAPTURE_TIMEOUT_MS,
      });
      await settleForCapture(page, opts.html);
      const fullPage = opts.fullPage ?? true;
      const height = fullPage
        ? Math.max(
            opts.viewport.h,
            await page
              .evaluate(() => document.documentElement.scrollHeight)
              .catch(() => opts.viewport.h),
          )
        : opts.viewport.h;
      if (opts.label) {
        await page.evaluate((label) => {
          const el = document.createElement("div");
          el.textContent = label;
          el.style.cssText =
            "position:fixed;left:12px;bottom:12px;z-index:2147483647;" +
            "font:600 11px/1 ui-sans-serif,system-ui,sans-serif;color:#fafafa;" +
            "background:rgba(24,24,27,.85);padding:6px 10px;border-radius:8px";
          document.body.appendChild(el);
        }, opts.label);
      }
      // pageRanges "1": with fullPage the measured height makes one page anyway
      // (this guards a rounding sliver); with fullPage: false it IS the clip.
      return await page.pdf({
        width: `${opts.viewport.w}px`,
        height: `${height}px`,
        printBackground: true,
        pageRanges: "1",
      });
    },
  );
}

/**
 * Multi-page PDF deck: one page per entry, in order, each page sized to its
 * own viewport (a review/handoff deck — a board's frames in board order).
 * One print job: each entry's full HTML doc is embedded as a same-origin
 * iframe in a wrapper document whose sections carry CSS *named pages*
 * (`page: pN` + `@page pN { size … }`) — modern Chromium honors a distinct
 * size per named page, so no per-entry print + pdf-lib merge is needed.
 * Heights follow `fullPage` semantics: after the iframes load and settle,
 * each iframe (and its named page) grows to its content height, so an entry
 * is always exactly one page.
 */
export async function pdfDeckBuffer(pages: PdfPageOptions[]): Promise<Buffer> {
  const first = pages[0];
  if (!first) throw new Error("pdfDeckBuffer: no pages");
  if (pages.length === 1) return pdfPageBuffer(first);
  const wrapper = buildDeckWrapper(pages);
  const maxW = Math.max(...pages.map((p) => p.viewport.w));
  const maxH = Math.max(...pages.map((p) => p.viewport.h));
  return withContext({ viewport: { width: maxW, height: maxH } }, async (context) => {
    const page = await context.newPage();
    await page.emulateMedia({ media: "screen" });
    await page.setContent(wrapper, { waitUntil: "domcontentloaded", timeout: CAPTURE_TIMEOUT_MS });
    // Every entry iframe loaded (ready flags, bounded like the compare wrapper).
    await page
      .waitForFunction(
        (count) => {
          for (let i = 0; i < count; i++) {
            const f = document.getElementById(`f${i}`);
            if (!(f instanceof HTMLIFrameElement) || f.dataset.ready !== "1") return false;
          }
          return true;
        },
        pages.length,
        { timeout: CAPTURE_TIMEOUT_MS },
      )
      .catch(() => {});
    // Fonts + live islands live inside the child frames, not the top document.
    await settleForCapture(page, wrapper, { liveIslands: false });
    await Promise.all(
      page
        .frames()
        .filter((f) => f !== page.mainFrame())
        .map(async (frame) => {
          const entry = pages[Number(frame.name().slice(1))];
          await waitForFonts(frame);
          if (entry) await waitForLiveIslands(frame, entry.html);
        }),
    );
    // Now that content has settled, measure each iframe and size it together
    // with its named page (same one-shot measure as pdfPageBuffer). Each
    // section's height matches its page box exactly in CSS px, so nothing
    // fragments onto a stray extra page.
    await page.evaluate(
      (entries) => {
        const rules: string[] = [];
        entries.forEach((e, i) => {
          const f = document.getElementById(`f${i}`);
          const section = document.getElementById(`s${i}`);
          if (!(f instanceof HTMLIFrameElement) || !(section instanceof HTMLElement)) return;
          const content = f.contentDocument?.documentElement?.scrollHeight ?? e.h;
          const height = e.fullPage ? Math.max(e.h, content) : e.h;
          f.height = String(height);
          section.style.height = `${height}px`;
          rules.push(`@page p${i}{size:${e.w}px ${height}px;margin:0}`);
        });
        const style = document.getElementById("deck-pages");
        if (style) style.textContent = rules.join("\n");
      },
      pages.map((p) => ({ w: p.viewport.w, h: p.viewport.h, fullPage: p.fullPage ?? true })),
    );
    return await page.pdf({ printBackground: true, preferCSSPageSize: true });
  });
}

/**
 * The single-print-job deck document: one section per entry, each a
 * same-origin srcdoc iframe on its own CSS named page. `@page` sizes here are
 * the pre-measure viewports — `pdfDeckBuffer` rewrites `#deck-pages` after the
 * frames settle and are measured. The label chip is *absolutely* positioned
 * inside its section (a `position: fixed` chip would repeat on every page of
 * the print job). Iframes start at the entry viewport height — never measure
 * from the 150px iframe default, because viewport-bound layouts (h-screen
 * roots) size themselves to whatever the iframe is; grow only on genuine
 * overflow (see buildCompareWrapper for the same rationale).
 */
function buildDeckWrapper(pages: PdfPageOptions[]): string {
  const styles = [
    "*{box-sizing:border-box}",
    "html,body{margin:0;padding:0}",
    // Named pages alone force a break between differently named sections;
    // break-after is belt and braces (skipping the last avoids a blank tail page).
    "section{position:relative;overflow:hidden}",
    "section:not(:last-of-type){break-after:page}",
    "iframe{border:0;display:block;background:#fff}",
    ".chip{position:absolute;left:12px;bottom:12px;z-index:2147483647;" +
      "font:600 11px/1 ui-sans-serif,system-ui,sans-serif;color:#fafafa;" +
      "background:rgba(24,24,27,.85);padding:6px 10px;border-radius:8px}",
  ].join("");
  const pageRules = pages
    .map((p, i) => `@page p${i}{size:${p.viewport.w}px ${p.viewport.h}px;margin:0}`)
    .join("\n");
  const sections = pages
    .map((p, i) => {
      const { w, h } = p.viewport;
      const chip = p.label ? `<div class="chip">${escapeHtml(p.label)}</div>` : "";
      return (
        `<section id="s${i}" style="page:p${i};width:${w}px;height:${h}px">` +
        `<iframe id="f${i}" name="f${i}" width="${w}" height="${h}" srcdoc="${escapeHtml(p.html)}"></iframe>${chip}</section>`
      );
    })
    .join("\n");
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>${styles}</style><style id="deck-pages">${pageRules}</style></head>
<body>
${sections}
<script>
for (let i = 0; i < ${pages.length}; i++) {
  const f = document.getElementById("f" + i);
  f.addEventListener("load", () => { f.dataset.ready = "1"; });
}
</script>
</body></html>`;
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
  return withContext(
    {
      // Width = 2 panels + 1px gutter + horizontal padding; arbitrary tall
      // initial height — we screenshot fullPage so the wrapper grows.
      viewport: { width: w * 2 + 24, height: 800 },
      deviceScaleFactor: opts.deviceScaleFactor ?? 1,
    },
    async (context) => {
      const page = await context.newPage();
      await page.setContent(wrapper, {
        waitUntil: "domcontentloaded",
        timeout: CAPTURE_TIMEOUT_MS,
      });
      // Wait until both iframes have measured + the wrapper sized itself.
      // Bounded to CAPTURE_TIMEOUT_MS so a stuck pane can't hang past the
      // capture budget (Playwright's default waitForFunction timeout is 30s).
      await page
        .waitForFunction(
          () => {
            const l = document.getElementById("L") as HTMLIFrameElement | null;
            const r = document.getElementById("R") as HTMLIFrameElement | null;
            return !!(l && r && l.dataset.ready === "1" && r.dataset.ready === "1");
          },
          undefined,
          { timeout: CAPTURE_TIMEOUT_MS },
        )
        .catch(() => {});
      // Islands live in the two child iframes, not the top document.
      await settleForCapture(page, wrapper, { liveIslands: false });
      return await page.screenshot({ fullPage: true, timeout: CAPTURE_TIMEOUT_MS });
    },
  );
}

/** Escape a full HTML doc (or label text) for embedding in a srcdoc attribute
 *  — the payload may contain double quotes. Shared by the composite wrappers. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildCompareWrapper(
  leftHtml: string,
  rightHtml: string,
  panelWidth: number,
  panelHeight: number,
  leftLabel: string,
  rightLabel: string,
): string {
  const esc = escapeHtml;
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
