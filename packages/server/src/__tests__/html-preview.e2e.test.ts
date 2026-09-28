import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Screen } from "@velloo/schema";
import { type Browser, chromium } from "playwright-core";
import { createServer, type ServerHandle } from "../index.ts";
import { scaffoldDesignFolder } from "../testing/design-folder.ts";

/**
 * An HTML/htmx design end to end through the real daemon: the render route
 * loads live fragments from a running host app through the proxy, htmx
 * search and boosted navigation work inside an interactive preview, and the
 * `screenshot` tool waits for the fragments before it shoots.
 * `VELLOO_E2E=1 bun test`.
 */
const RUN = process.env.VELLOO_E2E === "1";

const HOST_PAGE =
  '<main><span id="count" hx-get="count" hx-trigger="revealed">Loading</span>' +
  '<input id="search" name="q" hx-get="search" hx-trigger="keyup changed delay:50ms" hx-target="#rows">' +
  '<table><tbody id="rows"><tr><td>Carson</td></tr><tr><td>Joe</td></tr></tbody></table>' +
  '<a href="new">Add Contact</a></main>';

const html = (body: string) =>
  new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } });

const screens: Record<string, Screen> = {
  contacts: {
    id: "contacts",
    name: "Contacts",
    tree: { $ref: "HtmlFragment", props: { src: "/contacts", select: "main" } },
  },
  table: {
    id: "table",
    name: "Table",
    tree: {
      $ref: "Html",
      props: { as: "table" },
      children: [{ $ref: "HtmlFragment", props: { as: "tbody", src: "/rows" } }],
    },
  },
  direct: {
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
        { $ref: "Html", props: { as: "img", id: "logo", src: "/static/logo.svg", alt: "" } },
      ],
    },
  },
  missing: {
    id: "missing",
    name: "Missing route",
    tree: { $ref: "HtmlFragment", props: { src: "/gone" } },
  },
};

describe.skipIf(!RUN)("HTML/htmx preview through the daemon (Playwright)", () => {
  // Stands in for the app erroring while an agent edits it.
  let stylesDown = false;
  let host: ReturnType<typeof Bun.serve>;
  let folder: Awaited<ReturnType<typeof scaffoldDesignFolder>>;
  let server: ServerHandle;
  let browser: Browser;

  beforeAll(async () => {
    host = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: (request) => {
        const url = new URL(request.url);
        switch (url.pathname) {
          case "/contacts":
            return html(HOST_PAGE);
          case "/contacts/count":
          case "/count":
            return new Response("17");
          case "/contacts/search":
          case "/search":
            return html(url.searchParams.get("q") === "Carson" ? "<tr><td>Carson</td></tr>" : "");
          case "/rows":
            return html("<tr><td>Carson</td></tr>");
          // `href="new"` on /contacts resolves to /new, as in a browser.
          case "/new":
            return html('<form id="new-contact"><input name="first_name"></form>');
          case "/static/logo.svg":
            return new Response('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"/>', {
              headers: { "content-type": "image/svg+xml" },
            });
          case "/static/app.css":
            if (stylesDown) {
              return new Response("<h1>Internal Server Error</h1>", {
                status: 500,
                headers: { "content-type": "text/html" },
              });
            }
            return new Response("#count { color: rgb(1, 2, 3); }", {
              headers: { "content-type": "text/css" },
            });
          default:
            return new Response("not found", { status: 404 });
        }
      },
    });
    folder = await scaffoldDesignFolder({
      label: "html-e2e",
      config: {
        library: { id: "html" },
        styling: { framework: "none" },
        hostApp: {
          root: ".",
          previewUrl: `http://127.0.0.1:${host.port}`,
          stylesheets: ["/static/app.css"],
        },
      },
      screens,
    });
    server = await createServer({
      folder: folder.root,
      port: 0,
      mcp: { transport: "http", port: 0 },
    });
    browser = await chromium.launch();
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    await server?.close();
    await folder?.cleanup();
    host?.stop(true);
  });

  const open = async (screenId: string) => {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${server.url}/api/render/${screenId}?w=800&h=600&interact=1`);
    return { page, errors };
  };

  test("loads a live fragment with host CSS, filters rows, and follows a boosted link", async () => {
    const { page, errors } = await open("contacts");
    try {
      await page.waitForFunction(() => document.querySelector("#count")?.textContent === "17");
      expect(await page.locator("#count").evaluate((el) => getComputedStyle(el).color)).toBe(
        "rgb(1, 2, 3)",
      );
      expect(await page.locator("#rows tr").count()).toBe(2);
      await page.locator("#search").click();
      await page.keyboard.type("Carson");
      await page.waitForFunction(() => document.querySelectorAll("#rows tr").length === 1);
      await page.getByText("Add Contact").click();
      await page.locator("#new-contact").waitFor();
      expect(page.url()).toContain("/api/render/contacts");
      expect(errors).toEqual([]);
    } finally {
      await page.close();
    }
  }, 30_000);

  test("mounts table rows into a semantic tbody fragment", async () => {
    const { page } = await open("table");
    try {
      await page.locator("tbody tr").waitFor();
      expect(await page.locator("tbody tr td").innerText()).toBe("Carson");
      expect(await page.locator("tbody div").count()).toBe(0);
    } finally {
      await page.close();
    }
  }, 30_000);

  test("resolves relative htmx paths and root-relative host assets in editable HTML", async () => {
    const { page } = await open("direct");
    try {
      await page.waitForFunction(
        () => document.querySelector("#direct-count")?.textContent === "17",
      );
      await page.waitForFunction(
        () => (document.querySelector("#logo") as HTMLImageElement | null)?.naturalWidth === 8,
      );
    } finally {
      await page.close();
    }
  }, 30_000);

  const mcp = async (): Promise<Client> => {
    const client = new Client({ name: "html-e2e", version: "0.0.0" });
    const url = new URL(server.mcpUrl ?? "");
    url.searchParams.set("surface", "full");
    await client.connect(
      new StreamableHTTPClientTransport(url) as Parameters<typeof client.connect>[0],
    );
    return client;
  };

  const screenshotReport = async (client: Client, screenId: string) => {
    const result = (await client.callTool({ name: "screenshot", arguments: { screenId } })) as {
      content: { type: string; text?: string }[];
    };
    const text = result.content.find((part) => part.type === "text")?.text ?? "{}";
    return JSON.parse(text) as { hostFragments?: string };
  };

  test("screenshot waits for host fragments and flags the ones that failed", async () => {
    const client = await mcp();
    try {
      expect((await screenshotReport(client, "contacts")).hostFragments).toBeUndefined();
      expect((await screenshotReport(client, "missing")).hostFragments).toContain("404 /gone");
      stylesDown = true;
      expect((await screenshotReport(client, "direct")).hostFragments).toContain(
        "500 stylesheet /static/app.css",
      );
    } finally {
      stylesDown = false;
      await client.close();
    }
  }, 60_000);
});
