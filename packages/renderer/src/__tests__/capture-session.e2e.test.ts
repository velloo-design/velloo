import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startCaptureSession, TOOLBAR_SCRIPT } from "../browser-session.ts";
import type { DomExtract, ThemeVars } from "../capture-page.ts";
import { capturesDir, listCaptures, readSessionState, sessionStatePath } from "../capture-store.ts";

/**
 * Drives a real capture session against a local page. Opt-in (`VELLOO_E2E=1`)
 * like the other browser-backed suites — it needs a *headed* browser, which
 * the default headless-shell install can't provide.
 */
const RUN = process.env.VELLOO_E2E === "1";

const PAGE = `<!doctype html><html><head><title>Acme Dashboard</title><style>
:root { --background: oklch(1 0 0); --foreground: oklch(0.15 0 0); --primary: #4f46e5; }
.dark { --background: oklch(0.15 0 0); --foreground: oklch(0.98 0 0); }
body { background: var(--background); color: var(--foreground); font-family: Inter, sans-serif; margin:0; padding:32px; }
.grid { display:grid; grid-template-columns: repeat(3, 1fr); gap:16px; }
.card { border:1px solid #e5e7eb; border-radius:10px; padding:20px; }
h1 { font-size:32px; font-weight:700; }
</style></head><body>
<header><img src="/logo.svg" width="32" height="32"><h1>Acme Dashboard</h1></header>
<main class="grid">
  <section class="card"><h2>Revenue</h2><p>$12,400</p></section>
  <section class="card"><h2>Users</h2><p>1,284</p></section>
  <section class="card"><h2>Churn</h2><p>2.1%</p></section>
</main></body></html>`;

const LOGO =
  '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="14" fill="#4f46e5"/></svg>';

let home: string;
let root: string;
let server: ReturnType<typeof Bun.serve>;
let url: string;
const prevHome = process.env.VELLOO_HOME;

beforeAll(() => {
  if (!RUN) return;
  home = mkdtempSync(join(tmpdir(), "velloo-home-"));
  root = mkdtempSync(join(tmpdir(), "velloo-folder-"));
  process.env.VELLOO_HOME = home;
  server = Bun.serve({
    port: 0,
    fetch(req) {
      const path = new URL(req.url).pathname;
      if (path === "/logo.svg") {
        return new Response(LOGO, { headers: { "Content-Type": "image/svg+xml" } });
      }
      // Self-triggering pages, so the tab cases need no synthetic clicking.
      if (path === "/opens-tab") {
        return new Response(
          `<!doctype html><title>Opener</title><body><script>window.open("/other","_blank","noopener")</script>opener</body>`,
          { headers: { "Content-Type": "text/html" } },
        );
      }
      if (path === "/opens-popup") {
        return new Response(
          `<!doctype html><title>Opener</title><body><script>window.open("/signin","_blank","width=500,height=600")</script>opener</body>`,
          { headers: { "Content-Type": "text/html" } },
        );
      }
      if (path === "/other") {
        return new Response(`<!doctype html><title>Other</title><body>other</body>`, {
          headers: { "Content-Type": "text/html" },
        });
      }
      if (path === "/signin") {
        return new Response(`<!doctype html><title>Sign in</title><body>signin</body>`, {
          headers: { "Content-Type": "text/html" },
        });
      }
      return new Response(PAGE, {
        headers: {
          "Content-Type": "text/html",
          "Set-Cookie": "app_session=real-session-token; Path=/; Max-Age=3600",
        },
      });
    },
  });
  url = `http://127.0.0.1:${server.port}/dashboard`;
});

afterAll(() => {
  if (!RUN) return;
  server?.stop();
  if (prevHome === undefined) delete process.env.VELLOO_HOME;
  else process.env.VELLOO_HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
  rmSync(root, { recursive: true, force: true });
});

describe.skipIf(!RUN)("capture session (headed browser)", () => {
  test("captures a page into evidence, then persists a scoped session", async () => {
    const statePath = sessionStatePath(root, new URL(url).origin);
    const session = await startCaptureSession({
      folderRoot: root,
      url,
      sessionStatePath: statePath,
    });
    await session.capturePage();
    await session.captureTheme();
    await session.close();
    await session.finished;

    const captures = listCaptures(root);
    expect(captures).toHaveLength(2);

    const page = captures.find((c) => !c.themeOnly);
    const themeOnly = captures.find((c) => c.themeOnly);
    expect(page).toBeDefined();
    expect(themeOnly).toBeDefined();
    if (!page || !themeOnly) return;

    // Every capture is diffable later, so every capture records its viewport —
    // including a theme-only one, which has no DOM extract to borrow it from.
    expect(page.viewport.w).toBeGreaterThan(0);
    expect(themeOnly.viewport.w).toBeGreaterThan(0);

    const dir = join(capturesDir(root), page.id);
    for (const file of ["page.png", "dom.json", "computed-vars.json", "assets.json"]) {
      expect(existsSync(join(dir, file))).toBe(true);
    }

    const vars = JSON.parse(readFileSync(join(dir, "computed-vars.json"), "utf8")) as ThemeVars;
    // Both palettes have to come off the stylesheet: a computed-style read of
    // the root can only ever see the active one.
    expect(vars.css).toContain(":root");
    expect(vars.css).toContain(".dark");
    expect(Object.keys(vars.dark).length).toBeGreaterThan(0);
    expect(vars.light["--primary"]).toBe("#4f46e5");

    const dom = JSON.parse(readFileSync(join(dir, "dom.json"), "utf8")) as DomExtract;
    // Velloo's own injected toolbar must never appear in captured evidence.
    expect(dom.nodes.some((n) => n.tag.includes("velloo"))).toBe(false);
    // A repeated card run is the signal that says "one component, three times".
    expect(dom.nodes.some((n) => n.repeat?.count === 3)).toBe(true);
    expect(dom.nodes.some((n) => n.tag === "h1" && n.text === "Acme Dashboard")).toBe(true);

    const assets = JSON.parse(readFileSync(join(dir, "assets.json"), "utf8")) as {
      assets: Array<{ file: string }>;
    };
    expect(assets.assets.some((a) => a.file.endsWith("logo.svg"))).toBe(true);

    const state = readSessionState(statePath);
    expect(state?.cookies.some((c) => c.name === "app_session")).toBe(true);
    // The credential lives outside the design folder, always.
    expect(statePath.startsWith(root)).toBe(false);
  }, 120_000);

  test("holds the session to a single tab", async () => {
    const session = await startCaptureSession({ folderRoot: root, url });
    try {
      expect(session.openTabs()).toBe(1);
      expect(session.currentUrl()).toBe(url);
    } finally {
      await session.close();
      await session.finished;
    }
  }, 120_000);

  test("the toolbar carries the velloo mark and floats its status above the bar", async () => {
    const { chromium } = await import("playwright-core");
    const browser = await chromium.launch({ channel: "chrome", headless: true });
    try {
      const context = await browser.newContext({ viewport: { width: 900, height: 400 } });
      let storedPosition: unknown = null;
      await context.exposeBinding("__vellooCapture", async (_s, action: string, arg: unknown) => {
        if (action === "position") return storedPosition;
        if (action === "move") {
          storedPosition = arg;
          return "ok";
        }
        return "captured Acme";
      });
      await context.addInitScript(TOOLBAR_SCRIPT);
      const page = await context.newPage();
      await page.goto(`http://127.0.0.1:${server.port}/other`, {
        waitUntil: "domcontentloaded",
      });
      await page.waitForSelector("velloo-capture-toolbar");

      const shape = await page.evaluate(() => {
        const host = document.querySelector("velloo-capture-toolbar");
        const r = (host as HTMLElement | null)?.shadowRoot;
        const toast = r?.querySelector(".toast") as HTMLElement | null;
        const bar = r?.querySelector(".bar") as HTMLElement | null;
        return {
          hasMark: !!r?.querySelector(".mark svg"),
          markStrokes: Array.from(r?.querySelectorAll(".mark svg rect[stroke]") ?? []).map((n) =>
            n.getAttribute("stroke"),
          ),
          barBackground: bar ? getComputedStyle(bar).backgroundImage : null,
          buttons: Array.from(r?.querySelectorAll("button") ?? []).map((b) =>
            b.getAttribute("data-act"),
          ),
          toastPosition: toast ? getComputedStyle(toast).position : null,
          toastVisibleAtRest: toast?.classList.contains("show") ?? null,
          toastAboveBar:
            toast && bar
              ? toast.getBoundingClientRect().bottom <= bar.getBoundingClientRect().top + 1
              : null,
        };
      });

      expect(shape.hasMark).toBe(true);
      // The mark inverts to ink/cream: the bar itself is now brand coral, and a
      // coral mark on a coral bar would disappear.
      expect(shape.markStrokes).toEqual(["#3d1c12", "#fff7ed", "#3d1c12"]);
      // Loud on purpose — velloo's chrome on someone else's page has to read as
      // ours at a glance, not as part of the site.
      expect(shape.barBackground).toContain("gradient");
      expect(shape.barBackground).toContain("rgb(255, 111, 77)");
      expect(shape.buttons).toEqual(["page", "theme", "quit"]);
      expect(shape.toastPosition).toBe("absolute");
      expect(shape.toastVisibleAtRest).toBe(false);
      expect(shape.toastAboveBar).toBe(true);

      // The status lives out of flow, so showing it must not resize the bar and
      // shift a button out from under the user's cursor mid-click.
      const barWidth = async () =>
        page.evaluate(() => {
          const r = document.querySelector("velloo-capture-toolbar")?.shadowRoot;
          const bar = r?.querySelector(".bar");
          return bar ? bar.getBoundingClientRect().width : -1;
        });
      const before = await barWidth();
      await page.evaluate(() => {
        const r = document.querySelector("velloo-capture-toolbar")?.shadowRoot;
        const btn = r?.querySelector('button[data-act="page"]');
        if (btn instanceof HTMLButtonElement) btn.click();
      });
      await page.waitForFunction(() => {
        const r = document.querySelector("velloo-capture-toolbar")?.shadowRoot;
        return r?.querySelector(".toast")?.textContent === "captured Acme";
      });
      expect(await barWidth()).toBe(before);

      // Dragging by the bar moves the toolbar and reports the new spot to the
      // session — the page's own storage is never touched, so the site is left
      // exactly as it was and nothing leaks into the captured storage state.
      const originAt = async () =>
        page.evaluate(() => {
          const h = document.querySelector("velloo-capture-toolbar");
          const r = (h as HTMLElement).getBoundingClientRect();
          return { left: Math.round(r.left), top: Math.round(r.top) };
        });
      const from = await originAt();
      await page.mouse.move(from.left + 30, from.top + 18);
      await page.mouse.down();
      await page.mouse.move(240, 100, { steps: 10 });
      await page.mouse.up();
      const moved = await originAt();
      expect(moved.left).toBeLessThan(from.left);
      expect(moved.top).toBeLessThan(from.top);
      // Reported during the drag as well as at the end, so it is already on the
      // session side before anything navigates.
      const reported = storedPosition as { left?: unknown; top?: unknown } | null;
      expect(typeof reported?.left).toBe("number");
      expect(typeof reported?.top).toBe("number");
      const pageStorage = await page.evaluate(() => ({
        local: Object.keys(localStorage).length,
        session: Object.keys(sessionStorage).length,
      }));
      expect(pageStorage).toEqual({ local: 0, session: 0 });

      // A navigation builds a brand-new document, so the placement has to come
      // back from the session rather than from anything in the old page.
      await page.goto(`http://127.0.0.1:${server.port}/signin`, {
        waitUntil: "domcontentloaded",
      });
      await page.waitForSelector("velloo-capture-toolbar");
      await page.waitForFunction(() => {
        const h = document.querySelector("velloo-capture-toolbar");
        return !!h && (h as HTMLElement).style.left !== "";
      });
      const restored = await originAt();
      expect(restored).toEqual(moved);
    } finally {
      await browser.close();
    }
  }, 120_000);
});
