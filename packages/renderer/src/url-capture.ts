import type { Viewport } from "@velloo/schema";
import type { Page } from "playwright-core";
import { CAPTURE_TIMEOUT_MS, withContext } from "./browser-pool.ts";
import { capturePagePng, type DomExtract, extractDom } from "./capture-page.ts";

/** A cookie to seed before navigating — Playwright's `addCookies` shape, trimmed. */
export interface UrlCookie {
  name: string;
  value: string;
  /** Either `url` OR `domain`+`path` is required (Playwright's rule). */
  url?: string | undefined;
  domain?: string | undefined;
  path?: string | undefined;
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
  /** Computed styles + geometry per element, when `dom: true` was asked for. */
  dom?: DomExtract;
  /** What the scroll pass did, when one ran. */
  scroll?: ScrollPass;
  /** How many elements each `hide` selector took out of the capture — 0 is a selector that matched nothing. */
  hidden?: Record<string, number>;
}

/** A page scrolled end to end before its full-page capture. */
interface ScrollPass {
  steps: number;
  /** Page height in CSS px before and after: lazy content grows it. */
  heightBefore: number;
  heightAfter: number;
  /** The page was still growing when the pass stopped — a feed that never ends. */
  truncated: boolean;
}

export interface UrlScreenshotOptions {
  url: string;
  viewport: Viewport;
  deviceScaleFactor?: number | undefined;
  fullPage?: boolean | undefined;
  /** Bounded wait for network quiet before capture, ms. Default 8000. */
  settleTimeoutMs?: number | undefined;
  /**
   * Inject an authenticated session so auth-gated pages capture the real page
   * instead of a login redirect. `storageStatePath` points at a Playwright
   * storage-state JSON (cookies + origin localStorage in one file — the robust
   * path; produce it once with `playwright codegen`/a login script). `cookies`
   * and `localStorage` are simpler one-offs layered on top.
   */
  storageStatePath?: string | undefined;
  cookies?: UrlCookie[] | undefined;
  localStorage?: Record<string, string> | undefined;
  /**
   * Drive the target page into dark mode before capture so a Velloo dark
   * render diffs against the app's actual dark theme (not its light default).
   * Best-effort across the common toggles: emulates `prefers-color-scheme:
   * dark`, seeds `localStorage.theme = "dark"` before any script runs (covers
   * next-themes' default), and after load adds the `.dark` class +
   * `data-theme="dark"` to `<html>` (covers class-strategy Tailwind). An app
   * with a bespoke theme mechanism may not flip — verify the capture.
   */
  dark?: boolean | undefined;
  /** Also walk the page for computed styles + geometry (see `CaptureResult.dom`). */
  dom?: boolean | undefined;
  /**
   * Scroll the page end to end before a full-page capture, so what waits to be
   * seen — scroll-reveal sections, lazy images — is in the shot. Default true;
   * a viewport capture never scrolls.
   */
  scroll?: boolean | undefined;
  /**
   * CSS selectors taken out of the page (`display: none`) before it settles
   * and is captured: a consent banner, a chat launcher, whatever the page
   * draws that the design deliberately leaves out. A selector that is not
   * valid CSS rejects with {@link HideSelectorError}.
   */
  hide?: string[] | undefined;
}

/** A `hide` selector the page could not parse. */
export class HideSelectorError extends Error {
  constructor(readonly selectors: string[]) {
    super(
      `\`hide\` selectors that are not valid CSS: ${selectors.map((s) => JSON.stringify(s)).join(", ")}`,
    );
    this.name = "HideSelectorError";
  }
}

/**
 * Take every element matching `selectors` out of the page, and report how many
 * each one matches now. A rule in an adopted stylesheet rather than a style
 * set on the elements found: a banner that mounts a second after load is
 * hidden as it arrives, and a page's `style-src` policy, which would refuse an
 * injected `<style>`, does not apply to a sheet built through the CSSOM.
 * Idempotent, so it is run again just before the shot in case the page
 * replaced its adopted sheets in between.
 */
async function hideSelectors(page: Page, selectors: string[]): Promise<Record<string, number>> {
  const outcome = await page.evaluate((list) => {
    const invalid: string[] = [];
    const matched: Record<string, number> = {};
    for (const selector of list) {
      try {
        matched[selector] = document.querySelectorAll(selector).length;
      } catch {
        invalid.push(selector);
      }
    }
    if (invalid.length > 0) return { invalid, matched };
    type Marked = CSSStyleSheet & { vellooHide?: true };
    if (!document.adoptedStyleSheets.some((sheet: Marked) => sheet.vellooHide)) {
      const sheet: Marked = new CSSStyleSheet();
      sheet.vellooHide = true;
      for (const selector of list) {
        try {
          sheet.insertRule(`${selector} { display: none !important; }`);
        } catch {
          invalid.push(selector);
        }
      }
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    }
    return { invalid, matched };
  }, selectors);
  if (outcome.invalid.length > 0) throw new HideSelectorError(outcome.invalid);
  return outcome.matched;
}

const SCROLL_MAX_STEPS = 40;
const SCROLL_PAUSE_MS = 120;
const SCROLL_IMAGE_WAIT_MS = 3000;

/**
 * Once an element has been seen, it stays seen. A page reveals its sections as
 * they scroll into view and, as often as not, hides them again on the way out
 * (framer-motion's `whileInView` does by default) — so a pass that ends back at
 * the top would undo itself. Dropping the "left the viewport" entries of
 * anything that has intersected keeps what the pass revealed, and leaves what
 * starts in view (a header's top sentinel) in the state the top of the page
 * shows. Runs before any page script.
 */
function keepSeenElementsSeen(): void {
  const Native = window.IntersectionObserver;
  if (!Native) return;
  window.IntersectionObserver = class extends Native {
    constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
      const seen = new WeakSet<Element>();
      super((entries, observer) => {
        const kept = entries.filter((entry) => {
          if (entry.isIntersecting) seen.add(entry.target);
          return entry.isIntersecting || !seen.has(entry.target);
        });
        if (kept.length > 0) callback(kept, observer);
      }, options);
    }
  };
}

/**
 * Walk the page a viewport at a time, wait for the images that brought into
 * view, and return to the top. Null when the page can't be scrolled (it closed,
 * or it navigated mid-pass).
 */
async function scrollThrough(page: Page): Promise<ScrollPass | null> {
  return page
    .evaluate(
      async ({ maxSteps, pauseMs, imageWaitMs }) => {
        const height = () =>
          Math.max(document.documentElement?.scrollHeight ?? 0, document.body?.scrollHeight ?? 0);
        const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
        const to = (top: number) => window.scrollTo({ top, left: 0, behavior: "instant" });
        const heightBefore = height();
        // Overlapping steps, so an element whose reveal needs half of it in
        // view gets that on one step or the next.
        const stride = Math.max(1, Math.floor(window.innerHeight * 0.8));
        let top = 0;
        let steps = 0;
        while (top + window.innerHeight < height() && steps < maxSteps) {
          top += stride;
          to(top);
          await pause(pauseMs);
          steps += 1;
        }
        const truncated = top + window.innerHeight < height();
        to(0);
        const loading = [...document.images]
          .filter((image) => !image.complete)
          .map(
            (image) =>
              new Promise((resolve) => {
                image.addEventListener("load", resolve, { once: true });
                image.addEventListener("error", resolve, { once: true });
              }),
          );
        await Promise.race([Promise.all(loading), pause(imageWaitMs)]);
        // A header that restyles past the fold needs a beat to settle back.
        await pause(pauseMs * 2);
        return { steps, heightBefore, heightAfter: height(), truncated };
      },
      { maxSteps: SCROLL_MAX_STEPS, pauseMs: SCROLL_PAUSE_MS, imageWaitMs: SCROLL_IMAGE_WAIT_MS },
    )
    .catch(() => null);
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
        // Playwright's cookie type wants each optional key absent rather than
        // explicitly undefined — strip the ones the caller left unset.
        await context.addCookies(
          opts.cookies.map((cookie) => ({
            name: cookie.name,
            value: cookie.value,
            ...(cookie.url !== undefined ? { url: cookie.url } : {}),
            ...(cookie.domain !== undefined ? { domain: cookie.domain } : {}),
            ...(cookie.path !== undefined ? { path: cookie.path } : {}),
          })),
        );
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
      const scrolls = (opts.fullPage ?? true) && opts.scroll !== false;
      if (scrolls) await context.addInitScript(keepSeenElementsSeen);
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
      const hide = opts.hide?.length ? opts.hide : null;
      // Before the page settles, so a hidden overlay is not what the loading
      // check reads and not what the scroll pass scrolls behind.
      if (hide) await hideSelectors(page, hide);
      const settleMs = opts.settleTimeoutMs ?? 8000;
      const settleStart = Date.now();
      await page.waitForLoadState("networkidle", { timeout: settleMs }).catch(() => {});
      // Network idle is not "loaded" for an app that fetches its data after
      // first paint: a slow dev server (Vite compiling modules on first hit)
      // runs the idle wait out while the page still says "Loading…", and the
      // diff then scores the design against an empty shell. Wait out the
      // loading state too, within the same budget, and say so if it never ends.
      const stillLoading = await page
        .waitForFunction(
          () => {
            // Only what the screenshot would show counts: a hidden spinner
            // template or an off-screen `aria-busy` region is not a loading page.
            const shown = (el: Element) =>
              el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
            for (const el of document.querySelectorAll('[aria-busy="true"]')) {
              if (shown(el)) return false;
            }
            for (const el of document.body?.querySelectorAll("*") ?? []) {
              if (el.childElementCount > 0) continue;
              if (/^\s*loading[^a-z0-9]*$/i.test(el.textContent ?? "") && shown(el)) return false;
            }
            return true;
          },
          undefined,
          { timeout: Math.max(1000, settleMs - (Date.now() - settleStart)), polling: 100 },
        )
        .then(() => false)
        .catch(() => true);
      const scroll = scrolls && !stillLoading ? await scrollThrough(page) : null;
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
      const pageError = stillLoading
        ? "the target was still showing a loading state when it was captured — its data had not arrived, so the diff isn't about your design. Pass a higher settleTimeoutMs"
        : await page
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
      const hidden = hide ? await hideSelectors(page, hide) : null;
      const png = await capturePagePng(page, opts.fullPage ?? true, CAPTURE_TIMEOUT_MS);
      const dom = opts.dom ? await extractDom(page).catch(() => undefined) : undefined;
      return {
        png,
        finalUrl,
        authWall,
        pageError,
        ...(dom ? { dom } : {}),
        ...(scroll ? { scroll } : {}),
        ...(hidden ? { hidden } : {}),
      };
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
