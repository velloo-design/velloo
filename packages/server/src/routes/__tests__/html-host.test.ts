import { afterAll, describe, expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HOST_ROUTES_BASE } from "@velloo/renderer";
import { Hono } from "hono";
import {
  createHtmlHostRouter,
  hostAssetRequest,
  htmlHostFetch,
  scopeCookieToProxy,
} from "../html-host.ts";

const requests: Array<{ method: string; path: string; hx: string | null; body: string }> = [];
const host = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch: async (request) => {
    const path = new URL(request.url).pathname;
    if (path === "/redirect")
      return new Response(null, { status: 302, headers: { location: "/contacts" } });
    if (path === "/external-redirect")
      return new Response(null, { status: 302, headers: { location: "https://example.com/" } });
    if (path === "/static/app.css") {
      return new Response(
        '.a { background: url("/static/a.png") } .b { background: url(img/b.png) }',
        {
          headers: { "content-type": "text/css" },
        },
      );
    }
    if (path === "/login") {
      const headers = new Headers({ "content-type": "text/html" });
      headers.append("set-cookie", "session=abc; Path=/; Domain=127.0.0.1; HttpOnly");
      headers.append("set-cookie", "csrf=xyz");
      return new Response("<p>ok</p>", { headers });
    }
    requests.push({
      method: request.method,
      path,
      hx: request.headers.get("hx-request"),
      body: await request.text(),
    });
    return new Response(
      [
        '<main><img src="/static/icon.svg" srcset="/static/a.png 1x, /static/b.png 2x">',
        '<link rel="stylesheet" href="/static/app.css"><a href="/contacts/2">Two</a>',
        '<a href="https://example.com/x">Out</a><a href="//cdn.example.com/y">Cdn</a>',
        '<form action="/contacts/save"><button formaction="/contacts/delete">Del</button></form>',
        '<button hx-post="/save">Save</button><p>src="/not-an-attribute"</p>',
        '<div class="hero" style="background: url(/static/img/python.jpg) no-repeat"></div></main>',
      ].join(""),
      { headers: { "content-type": "text/html" } },
    );
  },
});
afterAll(() => host.stop());

const runtimeScript = join(tmpdir(), `velloo-htmx-${Date.now()}.js`);
await writeFile(runtimeScript, "window.htmx = {};");

const routerFor = (previewUrl: string | undefined, script?: string) => {
  const app = new Hono();
  app.route(
    HOST_ROUTES_BASE,
    createHtmlHostRouter({
      hostApp: () => (previewUrl ? { root: ".", previewUrl } : undefined),
      runtimeScript: () => script,
    }),
  );
  return app;
};
const app = routerFor(`http://127.0.0.1:${host.port}`, runtimeScript);

describe("host proxy", () => {
  test("forwards htmx requests with their method, headers and body", async () => {
    const response = await app.request("http://localhost/api/html/host/contacts?q=Carson", {
      method: "POST",
      headers: { "HX-Request": "true", "content-type": "text/plain", "x-other": "dropped" },
      body: "search=Carson",
    });
    expect(response.status).toBe(200);
    expect(requests.at(-1)).toEqual({
      method: "POST",
      path: "/contacts",
      hx: "true",
      body: "search=Carson",
    });
  });

  test("never serves the host's pages as a document on the daemon's origin", async () => {
    // A link to the proxy from any site would otherwise run the app's scripts
    // — or an XSS in it — with the daemon's API same-origin.
    const opened = await app.request("http://localhost/api/html/host/contacts", {
      headers: { "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" },
    });
    expect(opened.status).toBe(403);
    const framed = await app.request("http://localhost/api/html/host/contacts", {
      headers: { "sec-fetch-dest": "iframe" },
    });
    expect(framed.status).toBe(403);
    // A browser that sends no fetch metadata still gets an inert document.
    const fetched = await app.request("http://localhost/api/html/host/contacts");
    expect(fetched.headers.get("content-security-policy")).toContain("sandbox");
    expect(fetched.headers.get("content-security-policy")).toContain("script-src 'none'");
    expect(fetched.headers.get("x-content-type-options")).toBe("nosniff");
  });

  test("re-roots root-relative URLs with a parser and leaves hx-*, absolute URLs and text alone", async () => {
    const body = await (await app.request("http://localhost/api/html/host/contacts")).text();
    expect(body).toContain('src="/api/html/host/static/icon.svg"');
    expect(body).toContain(
      'srcset="/api/html/host/static/a.png 1x, /api/html/host/static/b.png 2x"',
    );
    expect(body).toContain('href="/api/html/host/static/app.css"');
    expect(body).toContain('href="/api/html/host/contacts/2"');
    expect(body).toContain('action="/api/html/host/contacts/save"');
    expect(body).toContain('formaction="/api/html/host/contacts/delete"');
    expect(body).toContain('href="https://example.com/x"');
    expect(body).toContain('href="//cdn.example.com/y"');
    expect(body).toContain('hx-post="/save"');
    expect(body).toContain('<p>src="/not-an-attribute"</p>');
    expect(body).toContain(
      'style="background: url(/api/html/host/static/img/python.jpg) no-repeat"',
    );
  });

  test("re-roots root-relative url() in proxied stylesheets", async () => {
    const css = await (await app.request("http://localhost/api/html/host/static/app.css")).text();
    expect(css).toBe(
      '.a { background: url("/api/html/host/static/a.png") } .b { background: url(img/b.png) }',
    );
  });

  test("scopes host cookies to the proxy path", async () => {
    const response = await app.request("http://localhost/api/html/host/login");
    expect(response.headers.getSetCookie()).toEqual([
      "session=abc; Path=/api/html/host/; HttpOnly",
      "csrf=xyz; Path=/api/html/host/",
    ]);
  });

  test("rewrites local redirects and refuses external ones", async () => {
    const local = await app.request("http://localhost/api/html/host/redirect");
    expect(local.status).toBe(302);
    expect(local.headers.get("location")).toBe("/api/html/host/contacts");
    const external = await app.request("http://localhost/api/html/host/external-redirect");
    expect(external.status).toBe(502);
  });

  test("refuses a non-local origin and explains a missing one", async () => {
    const remote = routerFor("http://example.com");
    expect((await remote.request("http://localhost/api/html/host/contacts")).status).toBe(400);
    const unset = routerFor(undefined);
    const response = await unset.request("http://localhost/api/html/host/contacts");
    expect(response.status).toBe(503);
    expect(await response.text()).toContain("hostApp.previewUrl");
  });
});

describe("runtime script", () => {
  test("serves the adapter's script and 404s without one", async () => {
    const served = await app.request("http://localhost/api/html/htmx.js");
    expect(served.status).toBe(200);
    expect(await served.text()).toBe("window.htmx = {};");
    expect((await routerFor(undefined).request("http://localhost/api/html/htmx.js")).status).toBe(
      404,
    );
  });
});

describe("htmlHostFetch", () => {
  test("answers host routes and passes on everything else", async () => {
    const fetchHost = htmlHostFetch({
      hostApp: () => ({ root: ".", previewUrl: `http://127.0.0.1:${host.port}` }),
      runtimeScript: () => runtimeScript,
    });
    expect(fetchHost(new Request("http://127.0.0.1:1/assets/logo.png"))).toBeNull();
    const response = await fetchHost(new Request("http://127.0.0.1:1/api/html/host/contacts"));
    expect(response?.status).toBe(200);
  });
});

test("scopeCookieToProxy keeps a nested path under the prefix", () => {
  expect(scopeCookieToProxy("a=1; path=/admin; Secure; SameSite=Lax")).toBe(
    "a=1; Path=/api/html/host/admin; Secure; SameSite=Lax",
  );
});

test("hostAssetRequest re-addresses only a design document's root-relative GETs", () => {
  const from = (referer: string | null, path = "/static/logo.png", method = "GET") =>
    hostAssetRequest(
      new Request(`http://127.0.0.1:7300${path}`, {
        method,
        headers: referer ? { referer } : {},
      }),
    );
  expect(from("http://127.0.0.1:7300/api/render/home?w=1")?.url).toBe(
    "http://127.0.0.1:7300/api/html/host/static/logo.png",
  );
  expect(from("http://127.0.0.1:7300/__velloo_capture/abc")?.url).toBe(
    "http://127.0.0.1:7300/api/html/host/static/logo.png",
  );
  expect(from("http://127.0.0.1:7300/")).toBeNull();
  expect(from(null)).toBeNull();
  expect(from("http://127.0.0.1:7300/api/render/home", "/static/x", "POST")).toBeNull();
  expect(from("http://127.0.0.1:7300/api/render/home", "/api/html/htmx.js")).toBeNull();
});
