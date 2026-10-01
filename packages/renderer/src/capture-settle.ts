import type { Frame, Page } from "playwright-core";
import { HOST_STYLESHEET_ATTRIBUTE } from "./host-files.ts";

/** Flags the injected live/canvas runtimes set on the rendered page's window. */
type VellooReadyFlags = {
  __velloo_live_ready?: boolean;
  __velloo_canvas_ready?: boolean;
};

/** Which injected runtimes a document carries, and so which flags to wait on. */
interface Runtimes {
  live: boolean;
  canvas: boolean;
}

const NO_RUNTIMES: Runtimes = { live: false, canvas: false };

/**
 * Ceiling on the ready wait. One cap covers both runtimes because they are no
 * longer independent: a canvas mount re-homes the live islands into the tree it
 * mounts, so the live gate opens only after the mount settles (LIVE_RUNTIME).
 * Reached only when something is genuinely stuck — both runtimes flip their
 * flag on failure as well as success, so this is a backstop, not the budget.
 */
const READY_TIMEOUT_MS = 12_000;

/**
 * Which runtimes a document carries, read off the PARSED DOM rather than the
 * HTML string that produced it. The difference is the whole of composite
 * capture: a board composite, the compare wrapper and the PDF deck each hold
 * every frame's document inside a `srcdoc` *attribute*, so a string probe says
 * "this page has a canvas mount" about a wrapper window no runtime ever
 * touches — and then waits out the cap on a flag nothing will ever set, and
 * shoots whatever the frames happen to be showing. A DOM probe answers for the
 * window the flags actually live on, with nothing for a caller to declare.
 */
async function runtimesOf(target: Page | Frame): Promise<Runtimes> {
  return target
    .evaluate(() => ({
      live: document.querySelector("[data-live-node]") !== null,
      canvas: document.getElementById("velloo-canvas-data") !== null,
    }))
    .catch(() => NO_RUNTIMES);
}

/**
 * Wait for this document's client mounts to settle so the capture lands the
 * real components' final frame, not the SSR skeleton. Both runtimes flip their
 * flag on success OR fallback, so a broken bundle can't stall the shot. One
 * combined predicate, not two sequential waits: the live gate re-closes when a
 * canvas mount injects markers of its own, which a live-then-canvas wait would
 * walk straight past.
 */
async function waitForRuntimes(target: Page | Frame, runtimes: Runtimes): Promise<void> {
  if (!runtimes.live && !runtimes.canvas) return;
  await target
    .waitForFunction(
      (want: Runtimes) => {
        const w = window as Window & VellooReadyFlags;
        return (
          (!want.live || w.__velloo_live_ready === true) &&
          (!want.canvas || w.__velloo_canvas_ready === true)
        );
      },
      runtimes,
      { timeout: READY_TIMEOUT_MS },
    )
    .catch(() => {});
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
 *  font must not stall the shot. Works on a child frame too (a composite's panes). */
async function waitForFonts(target: Page | Frame): Promise<void> {
  await target
    .evaluate(() => Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 2000))]))
    .catch(() => {});
}

/** Fonts, then whatever client mounts this one document carries. */
async function settleDocument(target: Page | Frame): Promise<void> {
  await waitForFonts(target);
  await waitForRuntimes(target, await runtimesOf(target));
}

/**
 * Wait for a loaded page to be ready to rasterize: the load event, then every
 * document on it — the top one and each child frame — settled in parallel.
 * Shared by every capture path so they cannot drift.
 *
 * Child frames are not an edge case. Each pane of a composite capture (a board
 * PNG, the light/dark compare, the PDF deck) is its own document with its own
 * webfonts and its own client mount, so the flags are on ITS window; the top
 * window's are never set. The compare and deck paths used to handle that by
 * hand, keyed frame-name → source HTML, and the board PNG — which has neither
 * — silently did not, so it waited out the cap on the wrong window and
 * captured whatever its frames had got to. Settling by frame instead of by
 * caller declaration is what makes that unforgettable.
 */
export async function settleForCapture(page: Page): Promise<void> {
  await page.waitForLoadState("load", { timeout: 5000 }).catch(() => {});
  const children = page.frames().filter((frame) => frame !== page.mainFrame());
  await Promise.all([settleDocument(page), ...children.map(settleDocument)]);
}
