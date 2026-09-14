import type { Viewport } from "@velloo/schema";
import { CAPTURE_TIMEOUT_MS, withContext } from "./browser-pool.ts";
import { type DomExtract, extractDom } from "./capture-page.ts";

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
      const dom = opts.dom ? await extractDom(page).catch(() => undefined) : undefined;
      return { png, finalUrl, authWall, pageError, ...(dom ? { dom } : {}) };
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
