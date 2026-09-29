import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Screen } from "@velloo/schema";
import { type Browser, chromium } from "playwright-core";
import { createServer, type ServerHandle } from "../index.ts";
import { scaffoldDesignFolder } from "../testing/design-folder.ts";

/**
 * An HTML design end to end through the real daemon: it is styled by the
 * copies of the app's stylesheets it keeps, never by the running app, and its
 * hx-* attributes never fire on the canvas. `VELLOO_E2E=1 bun test`.
 */
const RUN = process.env.VELLOO_E2E === "1";

const screens: Record<string, Screen> = {
  contacts: {
    id: "contacts",
    name: "Contacts",
    route: "/contacts",
    tree: {
      $ref: "Html",
      props: { as: "main" },
      children: [
        {
          $ref: "Html",
          props: {
            as: "span",
            id: "count",
            "hx-get": "/count",
            "hx-trigger": "load",
            children: "17 contacts",
          },
        },
        { $ref: "Html", props: { as: "img", id: "logo", src: "/static/logo.svg", alt: "" } },
        { $ref: "Html", props: { as: "a", id: "add", href: "/new", children: "Add Contact" } },
      ],
    },
  },
};

describe.skipIf(!RUN)("HTML design through the daemon (Playwright)", () => {
  let folder: Awaited<ReturnType<typeof scaffoldDesignFolder>>;
  let server: ServerHandle;
  let browser: Browser;

  beforeAll(async () => {
    folder = await scaffoldDesignFolder({
      label: "html-e2e",
      config: {
        library: { id: "html" },
        styling: { framework: "none" },
        hostApp: { root: "app", stylesheets: ["/static/app.css"] },
      },
      screens,
    });
    // The app's own source, where init and store_host_files find its files.
    await folder.write("app/static/app.css", "#count { color: rgb(1, 2, 3); }");
    await folder.write(
      "app/static/logo.svg",
      '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"/>',
    );
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
  });

  const mcp = async (): Promise<Client> => {
    const client = new Client({ name: "html-e2e", version: "0.0.0" });
    const url = new URL(server.mcpUrl ?? "");
    url.searchParams.set("surface", "full");
    await client.connect(
      new StreamableHTTPClientTransport(url) as Parameters<typeof client.connect>[0],
    );
    return client;
  };

  const call = async (client: Client, name: string, args: Record<string, unknown>) => {
    const result = (await client.callTool({ name, arguments: args })) as {
      isError?: boolean;
      content: { type: string; text?: string }[];
    };
    const text = result.content.find((part) => part.type === "text")?.text ?? "{}";
    return { isError: result.isError, body: JSON.parse(text) as Record<string, unknown> };
  };

  test("an unstyled design says which of the app's stylesheets it lacks", async () => {
    const client = await mcp();
    try {
      const { body } = await call(client, "screenshot", { screenId: "contacts" });
      expect(String(body.hostStyles)).toContain("stylesheet /static/app.css");
      expect(String(body.hostStyles)).toContain("store_host_files");
    } finally {
      await client.close();
    }
  }, 60_000);

  test("store_host_files copies the app's files from its source, and the design shows them", async () => {
    const client = await mcp();
    try {
      const { isError, body } = await call(client, "store_host_files", { from: "source" });
      expect(isError).toBeFalsy();
      expect(body.stored).toEqual(
        expect.arrayContaining(["assets/host/static/app.css", "assets/host/static/logo.svg"]),
      );
      expect(existsSync(join(folder.root, "assets/host/static/app.css"))).toBe(true);
      const { body: shot } = await call(client, "screenshot", { screenId: "contacts" });
      expect(shot.hostStyles).toBeUndefined();
    } finally {
      await client.close();
    }

    const page = await browser.newPage();
    const outside: string[] = [];
    page.on("request", (request) => {
      if (!request.url().startsWith(server.url)) outside.push(request.url());
    });
    try {
      await page.goto(`${server.url}/api/render/contacts?w=800&h=600`);
      await page.locator("#count").waitFor();
      expect(await page.locator("#count").evaluate((el) => getComputedStyle(el).color)).toBe(
        "rgb(1, 2, 3)",
      );
      await page.waitForFunction(
        () => (document.getElementById("logo") as HTMLImageElement).naturalWidth > 0,
      );
      // No htmx on the canvas: the design's hx-* attributes stay inert.
      await page.waitForTimeout(300);
      expect(await page.locator("#count").innerText()).toBe("17 contacts");
      expect(outside).toEqual([]);
    } finally {
      await page.close();
    }
  }, 60_000);

  test("on the canvas a click selects; it doesn't follow the app's links", async () => {
    const page = await browser.newPage();
    try {
      await page.goto(`${server.url}/api/render/contacts?w=800&h=600`);
      const before = page.url();
      await page.locator("#add").click();
      await page.waitForTimeout(300);
      expect(page.url()).toBe(before);
    } finally {
      await page.close();
    }
  }, 30_000);
});
