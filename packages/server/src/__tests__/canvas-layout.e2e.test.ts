import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join, resolve } from "node:path";
import { type Browser, chromium, type Page } from "playwright-core";
import { createServer, type ServerHandle } from "../index.ts";
import { designBoard, scaffoldDesignFolder } from "../testing/design-folder.ts";

/**
 * The workspace is exactly the window, whatever the frames hold. A board that
 * grew to its content once pushed the panes and the HUD out of view, and a
 * frame's autofocus (an app's login page) scrolled the page under them; both
 * shipped because nothing loaded the real canvas and measured it.
 * `VELLOO_E2E=1 bun test`.
 */
const RUN = process.env.VELLOO_E2E === "1";
// By path: the server sits below the canvas package, so it can't import it.
const CANVAS = resolve(import.meta.dir, "../../../canvas");

const LOGIN =
  '<!doctype html><html><body class="grid place-items-center">' +
  '<form><input id="email" autofocus><input type="password" id="password"></form>' +
  '<div style="height:4000px">tall</div></body></html>';

describe.skipIf(!RUN)("canvas layout (Playwright)", () => {
  let host: ReturnType<typeof Bun.serve>;
  let folder: Awaited<ReturnType<typeof scaffoldDesignFolder>>;
  let server: ServerHandle;
  let browser: Browser;

  beforeAll(async () => {
    const build = Bun.spawn(["bun", "run", "build"], {
      cwd: CANVAS,
      stdout: "ignore",
      stderr: "pipe",
    });
    if ((await build.exited) !== 0) {
      throw new Error(`canvas build failed: ${await new Response(build.stderr).text()}`);
    }
    host = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: () => new Response(LOGIN, { headers: { "content-type": "text/html" } }),
    });
    const ids = ["a", "b", "c", "d"];
    folder = await scaffoldDesignFolder({
      label: "canvas-layout",
      config: {
        library: { id: "html" },
        styling: { framework: "none" },
        hostApp: { root: ".", previewUrl: `http://127.0.0.1:${host.port}` },
      },
      screens: Object.fromEntries(
        ids.map((id) => [
          id,
          { id, name: id, tree: { $ref: "HtmlFragment", props: { src: `/${id}` } } },
        ]),
      ),
      boards: {
        app: {
          ...designBoard("app", ids),
          // Two rows, so the world is taller than the window too.
          frames: ids.map((screen, i) => ({
            id: `frame-${screen}`,
            screen,
            x: (i % 2) * 1600,
            y: Math.floor(i / 2) * 1200,
            w: 1440,
            h: 900,
          })),
        },
      },
    });
    server = await createServer({ folder: folder.root, port: 0, canvasDist: join(CANVAS, "dist") });
    browser = await chromium.launch();
  }, 120_000);

  afterAll(async () => {
    await browser?.close();
    await server?.close();
    await folder?.cleanup();
    host?.stop(true);
  });

  const measure = (page: Page) =>
    page.evaluate(() => {
      const root = document.scrollingElement as HTMLElement;
      const board = document.querySelector("[data-velloo-board]") as HTMLElement;
      const rect = board.getBoundingClientRect();
      return {
        pageOverflow: root.scrollHeight - innerHeight,
        pageScroll: root.scrollTop + root.scrollLeft,
        boardScroll: board.scrollTop + board.scrollLeft,
        boardBottom: rect.bottom - innerHeight,
        boardRight: rect.right - innerWidth,
      };
    });

  test("frames with tall, autofocusing pages leave the workspace where it is", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    try {
      await page.goto(`${server.url}/?board=app`);
      await page.locator("iframe").first().waitFor();
      // Let every frame load its page and focus its field.
      await page.waitForFunction(() => document.querySelectorAll("iframe").length >= 4, undefined, {
        timeout: 15_000,
      });
      await page.waitForTimeout(2_000);
      expect(await measure(page)).toEqual({
        pageOverflow: 0,
        pageScroll: 0,
        boardScroll: 0,
        boardBottom: 0,
        boardRight: expect.any(Number) as unknown as number,
      });
      expect((await measure(page)).boardRight).toBeLessThanOrEqual(0);
      // A wheel over the side pane chains to nothing.
      await page.mouse.move(100, 400);
      await page.mouse.wheel(0, 3_000);
      await page.waitForTimeout(300);
      expect((await measure(page)).pageScroll).toBe(0);
    } finally {
      await page.close();
    }
  }, 60_000);

  test("a field in a design frame can't be focused or typed into", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    try {
      await page.goto(`${server.url}/?board=app`);
      const frame = page.frameLocator("iframe").first();
      const email = frame.locator("#email");
      await email.waitFor();
      await email.click({ force: true });
      await page.keyboard.type("typed");
      expect(await email.inputValue()).toBe("");
      expect(await email.evaluate((el) => el === el.ownerDocument.activeElement)).toBe(false);
    } finally {
      await page.close();
    }
  }, 60_000);
});
