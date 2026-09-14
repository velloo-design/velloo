import type { Browser, BrowserContext } from "playwright-core";
import { BrowserMissingError, CHROMIUM_INSTALL_CMD } from "./browser-install.ts";

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
export const MAX_CONCURRENT_RENDERS = 3;

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
export async function withContext<T>(
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
export const CAPTURE_TIMEOUT_MS = 20_000;

/**
 * True for a Playwright timeout thrown by a capture step. Lets MCP callers
 * turn an opaque `TimeoutError` into an actionable hint rather than surfacing
 * the raw "Timeout 20000ms exceeded" line.
 */
export function isCaptureTimeout(err: unknown): boolean {
  return err instanceof Error && err.name === "TimeoutError";
}
