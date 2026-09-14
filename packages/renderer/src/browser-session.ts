import { existsSync, mkdirSync } from "node:fs";
import type { Browser, Page } from "playwright-core";
import { CHROMIUM_FULL_INSTALL_CMD } from "./browser-install.ts";
import { capturePage, TOOLBAR_TAG } from "./capture-page.ts";
import type { StorageState } from "./capture-session-state.ts";
import type { CaptureManifest } from "./capture-store.ts";
import { capturesDir, readSessionState, writeSessionState } from "./capture-store.ts";

/**
 * Thrown when no browser can be shown to the user. Distinct from
 * `BrowserMissingError` because the remedy is different: captures need a
 * *headed* browser, and the pinned headless-shell install can't provide one.
 */
export class HeadedBrowserMissingError extends Error {
  constructor(detail: string) {
    super(
      `A capture session needs a browser window, and none could be opened.\n${detail}\n` +
        `Either install Google Chrome (velloo will use it directly, no download), or run:\n  ${CHROMIUM_FULL_INSTALL_CMD}\n` +
        "(That's the full ~300MB browser — the one velloo already installs for screenshots is a headless shell with no window.)",
    );
    this.name = "HeadedBrowserMissingError";
  }
}

/**
 * Open a browser the user can actually see and drive.
 *
 * Chrome first, deliberately: `channel: "chrome"` borrows the Chrome already
 * on the machine, so there's no download at all, and the target site sees a
 * real Chrome user-agent and feature set — which matters when the whole point
 * is to reach a page as the user's own browser would. Only if that's missing
 * do we fall back to Playwright's own full build, and if that isn't installed
 * either the error says exactly which of the two to get.
 *
 * The pooled browser in `browser-pool.ts` is deliberately not reused: it's a
 * long-lived headless singleton shared by every render, and a session that a
 * human keeps open for minutes has nothing in common with that lifecycle.
 */
async function launchHeaded(): Promise<Browser> {
  const { chromium } = await import("playwright-core").catch(() => {
    throw new HeadedBrowserMissingError("playwright-core isn't available.");
  });
  try {
    return await chromium.launch({ headless: false, channel: "chrome" });
  } catch (chromeErr) {
    try {
      return await chromium.launch({ headless: false });
    } catch (bundledErr) {
      const detail = [chromeErr, bundledErr]
        .map((e) => (e instanceof Error ? e.message.split("\n")[0]?.trim() : String(e)))
        .filter(Boolean)
        .join(" / ");
      throw new HeadedBrowserMissingError(detail);
    }
  }
}

/**
 * Actions the in-page toolbar can ask for. `move`/`position` carry the
 * toolbar's placement, which is kept here rather than in the page: the site's
 * own localStorage is neither ours to write to nor safe to persist into (it
 * rides along in the captured storage state), and every navigation replaces
 * the document anyway.
 */
type ToolbarAction = "page" | "theme" | "quit" | "move" | "position";

/** Where the user dragged the toolbar, in viewport px. */
interface ToolbarPosition {
  left: number;
  top: number;
}

/**
 * The toolbar injected into every page of the session.
 *
 * It lives in the page rather than in the terminal because that's where the
 * user already is — they're logging in and clicking around, and making them
 * alt-tab to a shell to press a key would break that flow. It also means the
 * CLI and the MCP entry points share one implementation: an agent-started
 * session has no TTY to read keystrokes from, but it has this.
 *
 * Rendered into a shadow root so the host page's CSS can't restyle it and its
 * own styles can't leak out.
 */
/**
 * Exported so the session's own test can mount it in a blank page and assert
 * the structure — the toolbar is hidden during every capture, so it never
 * appears in a captured artifact to check after the fact.
 */
export const TOOLBAR_SCRIPT = `(() => {
  const TAG = ${JSON.stringify(TOOLBAR_TAG)};
  if (window.__vellooToolbarInstalled) return;
  window.__vellooToolbarInstalled = true;

  const MARK = '<svg viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
    '<defs><clipPath id="vlweave"><rect x="52" y="30" width="38" height="35"/></clipPath></defs>' +
    '<rect x="21" y="21" width="58" height="58" rx="20" stroke="#3d1c12" stroke-width="11" stroke-linejoin="round"/>' +
    '<rect x="41" y="41" width="58" height="58" rx="20" stroke="#fff7ed" stroke-width="11" stroke-linejoin="round"/>' +
    '<rect x="21" y="21" width="58" height="58" rx="20" stroke="#3d1c12" stroke-width="11" stroke-linejoin="round" clip-path="url(#vlweave)"/>' +
    '</svg>';

  // Position lives in the session (Node side), not in the page: writing it to
  // the site's localStorage would pollute the user's app AND ride along in the
  // captured storage state. Asking for it on mount also means a drag survives
  // navigation, where the whole document (and any in-page state) is replaced.
  let pos = null;

  const clamp = (p) => ({
    left: Math.max(8, Math.min(p.left, window.innerWidth - 120)),
    top: Math.max(8, Math.min(p.top, window.innerHeight - 40)),
  });

  const place = (host, p) => {
    const c = clamp(p);
    host.style.left = c.left + "px";
    host.style.top = c.top + "px";
    host.style.right = "auto";
    host.style.bottom = "auto";
  };

  const mount = async () => {
    if (document.querySelector(TAG)) return;
    if (!document.body) return;
    const host = document.createElement(TAG);
    host.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483647;";
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = \`
      <style>
        .wrap { position:relative; }
        /* Deliberately loud: this is velloo's chrome sitting on somebody
           else's page, and it has to read as ours at a glance rather than as
           part of the site. Brand coral→amber, dark ink on top. */
        .bar { display:flex; align-items:center; gap:8px; padding:8px 10px 8px 8px;
          background:linear-gradient(100deg,#FF6F4D 0%,#FF8A3D 55%,#FFAB1F 100%);
          color:#2b1206; border-radius:12px;
          box-shadow:0 8px 28px rgba(255,111,77,.38), 0 2px 8px rgba(0,0,0,.22);
          font:600 12px/1.2 ui-sans-serif,system-ui,-apple-system,sans-serif;
          cursor:grab; user-select:none; -webkit-user-select:none; }
        .bar.dragging { cursor:grabbing; box-shadow:0 12px 34px rgba(255,111,77,.5); }
        .grip { display:flex; align-items:center; gap:7px; padding-right:2px; }
        .mark { width:19px; height:19px; display:block; flex:none; }
        .name { letter-spacing:.02em; }
        button { appearance:none; border:0; border-radius:7px; padding:6px 10px;
          background:rgba(255,255,255,.82); color:#2b1206; font:inherit; cursor:pointer;
          box-shadow:0 1px 2px rgba(0,0,0,.12); }
        button:hover { background:#fff; }
        button.quit { background:#2b1206; color:#fff2e6; }
        button.quit:hover { background:#431d0a; }
        button[disabled] { opacity:.55; cursor:progress; }
        /* Floating above the bar, out of flow: a status that shared the bar's
           row would resize it and shift the buttons under the user's cursor
           mid-click. */
        .toast { position:absolute; bottom:calc(100% + 8px); right:0;
          max-width:320px; padding:7px 11px; border-radius:8px;
          background:#fffdfa; color:#2b1206;
          box-shadow:0 6px 24px rgba(0,0,0,.24);
          font:500 12px/1.35 ui-sans-serif,system-ui,-apple-system,sans-serif;
          white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
          opacity:0; transform:translateY(4px); pointer-events:none;
          transition:opacity .14s ease, transform .14s ease; }
        .toast.show { opacity:1; transform:translateY(0); }
        .toast.busy { background:#2b1206; color:#fff2e6; }
      </style>
      <div class="wrap">
        <div class="toast" role="status" aria-live="polite"></div>
        <div class="bar" title="Drag to move">
          <span class="grip"><span class="mark">\${MARK}</span><span class="name">velloo</span></span>
          <button data-act="page">Capture page</button>
          <button data-act="theme">Capture theme</button>
          <button class="quit" data-act="quit">Done</button>
        </div>
      </div>\`;

    const toast = root.querySelector(".toast");
    const bar = root.querySelector(".bar");
    let hideTimer = 0;
    const say = (text, busy) => {
      if (!toast) return;
      window.clearTimeout(hideTimer);
      toast.textContent = text;
      toast.classList.toggle("busy", !!busy);
      toast.classList.add("show");
      // A busy message stays until its outcome replaces it; an outcome fades.
      if (!busy) hideTimer = window.setTimeout(() => toast.classList.remove("show"), 2600);
    };

    for (const btn of root.querySelectorAll("button")) {
      btn.addEventListener("click", async () => {
        const act = btn.getAttribute("data-act");
        const buttons = Array.from(root.querySelectorAll("button"));
        for (const b of buttons) b.setAttribute("disabled", "true");
        say(act === "quit" ? "finishing up…" : act === "theme" ? "capturing theme…" : "capturing page…", true);
        try {
          const msg = await window.__vellooCapture(act);
          say(String(msg ?? ""), false);
        } catch (e) {
          say("capture failed", false);
        } finally {
          for (const b of buttons) b.removeAttribute("disabled");
        }
      });
    }

    // Drag by the bar itself — a toolbar pinned over the one control the user
    // needs is worse than no toolbar. Buttons keep their click.
    let drag = null;
    bar.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      if (e.target && e.target.closest && e.target.closest("button")) return;
      const r = host.getBoundingClientRect();
      drag = { dx: e.clientX - r.left, dy: e.clientY - r.top, moved: false };
      bar.classList.add("dragging");
      bar.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    // Report while dragging, not only at the end: a drag followed immediately
    // by a navigation would otherwise lose the position, since the document
    // (and the in-flight call) goes away with the old page.
    let lastReport = 0;
    const report = (p) => {
      pos = clamp(p);
      window.__vellooCapture("move", pos).catch(() => {});
    };
    bar.addEventListener("pointermove", (e) => {
      if (!drag) return;
      drag.moved = true;
      pos = { left: e.clientX - drag.dx, top: e.clientY - drag.dy };
      place(host, pos);
      const now = Date.now();
      if (now - lastReport > 120) {
        lastReport = now;
        report(pos);
      }
    });
    const endDrag = (e) => {
      if (!drag) return;
      const moved = drag.moved;
      drag = null;
      bar.classList.remove("dragging");
      try { bar.releasePointerCapture(e.pointerId); } catch (err) {}
      // Hand the final spot to the session so the next page opens where this
      // one ended.
      if (moved && pos) report(pos);
    };
    bar.addEventListener("pointerup", endDrag);
    bar.addEventListener("pointercancel", endDrag);

    document.body.appendChild(host);

    // Restore where the user last put it (this document is brand new).
    if (pos) {
      place(host, pos);
    } else {
      try {
        const stored = await window.__vellooCapture("position");
        if (stored && typeof stored.left === "number") {
          pos = stored;
          if (document.contains(host)) place(host, pos);
        }
      } catch (e) {}
    }
  };

  const mountSafely = () => { void mount(); };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountSafely, { once: true });
  } else {
    mountSafely();
  }
  // Some apps replace document.body wholesale on hydration/route change.
  const observer = new MutationObserver(mountSafely);
  if (document.documentElement) observer.observe(document.documentElement, { childList: true, subtree: false });
  // Backstop: a document.open()/write() replaces documentElement outright, which
  // silently detaches the observer above. A slow poll costs nothing and means
  // the toolbar can never go missing for more than a second.
  window.setInterval(mountSafely, 1000);
})();`;

/**
 * Chrome's own tab-vs-popup rule, read off the window features requested in a
 * CDP `Page.windowOpen`: a plain tab is opened with the full browser UI
 * (`toolbar`, `menubar`, …), while a popup asks for sizing instead and
 * suppresses them.
 *
 * This is the discriminator single-tab enforcement turns on, so it is exported
 * and unit-tested. `page.opener()` cannot do the job — it returns the creating
 * page for an ordinary `target="_blank"` link too, even with `rel="noopener"`.
 */
export function featuresMeanPopup(features: readonly string[]): boolean {
  // No features reported is no evidence of popup-ness — and folding is the safe
  // default for a session that promises a single tab. A genuine popup always
  // asks for something (sizing, at minimum).
  if (features.length === 0) return false;
  return !features.includes("toolbar") && !features.includes("menubar");
}

export interface CaptureSessionOptions {
  /** Design folder root — decides where captures and session state live. */
  folderRoot: string;
  folderId?: string;
  /** Opened on start, and the origin the session is scoped to. */
  url?: string;
  /** Path of the persisted session credential; omit to not persist one. */
  sessionStatePath?: string;
  onCapture?: (manifest: CaptureManifest) => void;
  onStatus?: (message: string) => void;
}

export interface CaptureSessionHandle {
  sessionId: string;
  /** Captures made so far, oldest first. */
  captures: () => CaptureManifest[];
  /** URL of the tab captures are taken from. */
  currentUrl: () => string;
  /**
   * Open tabs. Single-tab enforcement holds this at 1, except while a sign-in
   * popup is up (those are left alone — folding one would break the login).
   */
  openTabs: () => number;
  capturePage: () => Promise<CaptureManifest>;
  captureTheme: () => Promise<CaptureManifest>;
  /** Resolves once the session has ended (toolbar "Done", or window closed). */
  finished: Promise<void>;
  close: () => Promise<void>;
}

/**
 * Start a human-driven capture session: open a window, let the user log in and
 * navigate wherever they need, and turn any page they choose into evidence.
 *
 * The session owns a real browser for as long as the user wants it, which is
 * why nothing here blocks a caller waiting for a result — the CLI watches
 * `finished`, and the MCP tool returns a session id immediately and lets the
 * agent poll.
 */
export async function startCaptureSession(
  opts: CaptureSessionOptions,
): Promise<CaptureSessionHandle> {
  const sessionId = `cs_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const root = capturesDir(opts.folderRoot, opts.folderId);
  mkdirSync(root, { recursive: true, mode: 0o700 });

  const browser = await launchHeaded();

  // A previously scoped session file logs the user straight back in, so a
  // repeat capture of the same app usually needs no login at all.
  const prior =
    opts.sessionStatePath && existsSync(opts.sessionStatePath)
      ? readSessionState(opts.sessionStatePath)
      : null;

  const context = await browser.newContext({
    viewport: null,
    ...(prior ? { storageState: prior } : {}),
  });

  const made: CaptureManifest[] = [];
  // Scoping targets: where the session was pointed, plus everywhere the user
  // actually captured. Origins merely passed through on the way (an identity
  // provider's login form) are deliberately not included.
  const capturedOrigins = new Set<string>();
  if (opts.url) {
    try {
      capturedOrigins.add(new URL(opts.url).origin);
    } catch {
      // A malformed start URL just means no origin to seed.
    }
  }

  let finish: () => void = () => {};
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let closing = false;

  // Pinned at creation below. Capture always targets THIS page, never
  // "whatever opened last" — so a stray popup can never become the thing that
  // gets captured, and the toolbar the user clicked is always the page they get.
  let primary: Page | null = null;

  const activePage = async (): Promise<Page> => {
    if (primary && !primary.isClosed()) return primary;
    const page = context.pages().find((p) => !p.isClosed());
    if (!page) throw new Error("the browser has no open page to capture");
    return page;
  };

  /**
   * Was each newly-opened target a popup window or a plain tab? Filled by the
   * CDP `Page.windowOpen` event, which fires just before the corresponding
   * page event, so a FIFO queue pairs them exactly — and unlike matching on
   * URL, it survives the popup redirecting on its way to a sign-in page.
   *
   * `page.opener()` is NOT usable for this: it returns the creating page for a
   * plain `target="_blank"` link too (even with `rel="noopener"`), so it can't
   * tell a tab from a popup.
   */
  const openedAsPopup: boolean[] = [];

  /**
   * Keep the session to a single tab: anything the page opens in a new tab is
   * navigated in the capture tab instead, and the extra tab is closed.
   *
   * One exception, and it matters here more than anywhere: a sign-in popup
   * talks back to its opener, so folding it would break the very login this
   * session exists to perform. Popups are therefore left alone, and the capture
   * tab is refocused when one closes. Capture targets `primary` regardless, so
   * even a lingering popup can't change what gets captured.
   */
  const foldExtraTab = async (extra: Page): Promise<void> => {
    if (primary === null || extra === primary) return;
    // No matching windowOpen means we can't call it a popup — fold it, which is
    // the safe default for a session that promises one tab.
    const isPopup = openedAsPopup.shift() ?? false;
    if (isPopup) {
      extra.once("close", () => {
        void primary?.bringToFront().catch(() => undefined);
      });
      return;
    }
    // A freshly-opened target starts on about:blank and only then navigates, so
    // reading its URL immediately (or after waitForLoadState, which resolves
    // against that initial empty document) yields nothing to fold to.
    const deadline = Date.now() + 5000;
    let url = extra.url();
    while ((url === "" || url === "about:blank") && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
      if (extra.isClosed()) break;
      url = extra.url();
    }
    await extra.close().catch(() => undefined);
    if (url && url !== "about:blank") {
      await primary
        .goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 })
        .catch(() => undefined);
      opts.onStatus?.(`opened ${url} in the capture tab`);
    }
    await primary.bringToFront().catch(() => undefined);
  };

  const runCapture = async (themeOnly: boolean): Promise<CaptureManifest> => {
    const page = await activePage();
    try {
      capturedOrigins.add(new URL(page.url()).origin);
    } catch {
      // about:blank and friends — nothing to scope.
    }
    const { manifest } = await capturePage(page, { capturesRoot: root, themeOnly });
    made.push(manifest);
    opts.onCapture?.(manifest);
    return manifest;
  };

  let toolbarPosition: ToolbarPosition | null = null;

  await context.exposeBinding(
    "__vellooCapture",
    async (_source, action: ToolbarAction, arg?: unknown) => {
      try {
        if (action === "position") return toolbarPosition;
        if (action === "move") {
          const p = arg as Partial<ToolbarPosition> | undefined;
          if (typeof p?.left === "number" && typeof p?.top === "number") {
            toolbarPosition = { left: p.left, top: p.top };
          }
          return "ok";
        }
        if (action === "quit") {
          void close();
          return "done";
        }
        const manifest = await runCapture(action === "theme");
        const label =
          action === "theme" ? "theme captured" : `captured ${manifest.title || "page"}`;
        opts.onStatus?.(`${label} (${manifest.id})`);
        return label;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        opts.onStatus?.(`capture failed: ${message}`);
        return "failed";
      }
    },
  );
  await context.addInitScript(TOOLBAR_SCRIPT);

  const close = async (): Promise<void> => {
    if (closing) return;
    closing = true;
    // Persist BEFORE tearing down — storageState() needs a live context.
    if (opts.sessionStatePath) {
      try {
        const state: StorageState = await context.storageState();
        writeSessionState(opts.sessionStatePath, state, Array.from(capturedOrigins));
      } catch {
        // No session persisted is a degraded outcome, not a failed session.
      }
    }
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
    finish();
  };

  // The user closing the window IS ending the session.
  browser.on("disconnected", () => {
    if (!closing) {
      closing = true;
      finish();
    }
  });

  const page = await context.newPage();
  primary = page;
  try {
    const cdp = await context.newCDPSession(page);
    await cdp.send("Page.enable");
    cdp.on("Page.windowOpen", (e) => {
      openedAsPopup.push(featuresMeanPopup(e.windowFeatures ?? []));
    });
  } catch {
    // Without CDP every new target folds — one tab, at the cost of possibly
    // folding a sign-in popup. Preferring the stated guarantee is the right
    // default; the fallback only bites on a browser that denies CDP.
  }
  context.on("page", (extra) => {
    void foldExtraTab(extra).catch(() => undefined);
  });
  if (opts.url) {
    await page.goto(opts.url, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {
      opts.onStatus?.(`couldn't open ${opts.url} — navigate manually in the window`);
    });
  }

  return {
    sessionId,
    captures: () => [...made],
    currentUrl: () => (primary && !primary.isClosed() ? primary.url() : ""),
    openTabs: () => context.pages().filter((p) => !p.isClosed()).length,
    capturePage: () => runCapture(false),
    captureTheme: () => runCapture(true),
    finished,
    close,
  };
}
