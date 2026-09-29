import type { Frame, Page } from "playwright-core";
import { HOST_STYLESHEET_ATTRIBUTE } from "./host-files.ts";

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
export async function waitForLiveIslands(target: Page | Frame, html: string): Promise<void> {
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

/**
 * The host stylesheets the page links that didn't load — a design whose
 * stored copy is missing — as one line each (`404 stylesheet /static/site.css`).
 * Undefined when the page links none. A failed sheet still gets an (empty)
 * sheet object, so the resource timing entry's status is what tells.
 */
export async function missingHostStylesheets(
  target: Page | Frame,
  html: string,
): Promise<string[] | undefined> {
  if (!html.includes(HOST_STYLESHEET_ATTRIBUTE)) return undefined;
  return target
    .evaluate(
      (attribute) =>
        [...document.querySelectorAll<HTMLLinkElement>(`link[${attribute}]`)].flatMap((link) => {
          const entry = performance.getEntriesByName(link.href)[0] as
            | (PerformanceEntry & { responseStatus?: number })
            | undefined;
          if (!entry) return [];
          const status = entry.responseStatus ?? 0;
          // A cross-origin sheet reports 0 without Timing-Allow-Origin; a
          // same-origin one only when it was refused.
          const sameOrigin = new URL(link.href).origin === location.origin;
          const failed = status >= 400 || (sameOrigin && status === 0);
          return failed
            ? [`${status || "blocked"} stylesheet ${link.getAttribute(attribute)}`]
            : [];
        }),
      HOST_STYLESHEET_ATTRIBUTE,
    )
    .catch(() => undefined);
}

/** Bounded webfont wait — Google Fonts `<link>` loads lazily, and a slow/offline
 *  font must not stall the shot. Works on a child frame too (the deck wrapper). */
export async function waitForFonts(target: Page | Frame): Promise<void> {
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
export async function settleForCapture(
  page: Page,
  html: string,
  opts: { liveIslands?: boolean } = {},
): Promise<void> {
  await page.waitForLoadState("load", { timeout: 5000 }).catch(() => {});
  await waitForFonts(page);
  if (opts.liveIslands !== false) await waitForLiveIslands(page, html);
}
