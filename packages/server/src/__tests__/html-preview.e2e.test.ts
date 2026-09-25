import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createProvider } from "@velloo/provider-html";
import { renderScreen } from "@velloo/renderer";
import type { Screen, Theme } from "@velloo/schema";
import { Hono } from "hono";
import { chromium } from "playwright-core";
import { createHtmlHostRouter } from "../routes/html-host.ts";

const RUN = process.env.VELLOO_E2E === "1";

const theme: Theme = {
  name: "html-test",
  colors: {
    background: "#fff",
    foreground: "#111",
    primary: { DEFAULT: "#111", foreground: "#fff" },
  },
  typography: { fontFamily: { sans: "sans-serif" } },
  spacing: { 1: 4 },
  radius: { md: 4 },
};
const screen: Screen = {
  id: "contacts",
  name: "Contacts",
  tree: { $ref: "HtmlFragment", props: { src: "/page", select: "main" } },
};

describe.skipIf(!RUN)("HTML/htmx preview (Playwright)", () => {
  let host: ReturnType<typeof Bun.serve>;
  let canvas: ReturnType<typeof Bun.serve>;

  beforeAll(async () => {
    host = Bun.serve({
      port: 0,
      fetch: (request) => {
        const url = new URL(request.url);
        if (url.pathname === "/contacts/count") return new Response("17");
        if (url.pathname === "/rows")
          return new Response("<tr><td>Carson</td></tr>", {
            headers: { "content-type": "text/html" },
          });
        if (url.pathname === "/count") return new Response("17");
        if (url.pathname === "/search")
          return new Response(
            url.searchParams.get("q") === "Carson" ? "<tr><td>Carson</td></tr>" : "",
          );
        if (url.pathname === "/new")
          return new Response('<form id="new-contact"><input name="first_name"></form>', {
            headers: { "content-type": "text/html" },
          });
        return new Response(
          '<main><span id="count" hx-get="count" hx-trigger="revealed">Loading</span><input id="search" name="q" hx-get="search" hx-trigger="keyup changed delay:50ms" hx-target="#rows"><table><tbody id="rows"><tr><td>Carson</td></tr><tr><td>Joe</td></tr></tbody></table><a href="new">Add Contact</a></main>',
          { headers: { "content-type": "text/html" } },
        );
      },
    });
    const { html } = await renderScreen(screen, theme, {
      viewport: { w: 800, h: 600 },
      snapshotCss: "",
      registry: createProvider().registry,
      htmlHtmx: true,
    });
    const { html: tableHtml } = await renderScreen(
      {
        id: "table",
        name: "Table",
        tree: {
          $ref: "Html",
          props: { as: "table" },
          children: [{ $ref: "HtmlFragment", props: { as: "tbody", src: "/rows" } }],
        },
      },
      theme,
      {
        viewport: { w: 800, h: 600 },
        snapshotCss: "",
        registry: createProvider().registry,
        htmlHtmx: true,
      },
    );
    const { html: directHtml } = await renderScreen(
      {
        id: "direct",
        name: "Direct HTML",
        route: "/contacts/page",
        tree: {
          $ref: "Html",
          props: { as: "main" },
          children: [
            {
              $ref: "Html",
              props: {
                as: "span",
                id: "direct-count",
                "hx-get": "count",
                "hx-trigger": "load",
                children: "Loading",
              },
            },
          ],
        },
      },
      theme,
      {
        viewport: { w: 800, h: 600 },
        snapshotCss: "",
        registry: createProvider().registry,
        htmlHtmx: true,
      },
    );
    const app = new Hono();
    app.route(
      "/api/html",
      createHtmlHostRouter(() => ({ root: ".", previewUrl: `http://127.0.0.1:${host.port}` })),
    );
    app.get("/api/render", (c) => c.html(html));
    app.get("/api/table", (c) => c.html(tableHtml));
    app.get("/api/direct", (c) => c.html(directHtml));
    canvas = Bun.serve({ port: 0, fetch: app.fetch });
  });

  afterAll(() => {
    canvas?.stop(true);
    host?.stop(true);
  });

  test("loads a live fragment, updates a nested target, filters rows, and follows a boosted link", async () => {
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${canvas.port}/api/render?interact=1`);
      await page.waitForFunction(() => document.querySelector("#count")?.textContent === "17");
      expect(await page.locator("#rows tr").count()).toBe(2);
      await page.locator("#search").click();
      await page.keyboard.type("Carson");
      await page.waitForFunction(() => document.querySelectorAll("#rows tr").length === 1);
      expect(await page.locator("#rows").innerText()).toContain("Carson");
      await page.getByText("Add Contact").click();
      await page.locator("#new-contact").waitFor();
      expect(page.url()).toContain("/api/render?interact=1");
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
    }
  });

  test("mounts table rows into a semantic tbody fragment", async () => {
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.goto(`http://127.0.0.1:${canvas.port}/api/table?interact=1`);
      await page.locator("tbody tr").waitFor();
      expect(await page.locator("tbody tr td").innerText()).toBe("Carson");
      expect(await page.locator("tbody div").count()).toBe(0);
    } finally {
      await browser.close();
    }
  });

  test("resolves relative htmx paths in editable HTML against the screen route", async () => {
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.goto(`http://127.0.0.1:${canvas.port}/api/direct?interact=1`);
      await page.waitForFunction(
        () => document.querySelector("#direct-count")?.textContent === "17",
      );
      expect(await page.locator("#direct-count").innerText()).toBe("17");
    } finally {
      await browser.close();
    }
  });
});
