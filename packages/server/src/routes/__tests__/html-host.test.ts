import { afterAll, expect, test } from "bun:test";
import { Hono } from "hono";
import { createHtmlHostRouter } from "../html-host.ts";

const requests: Array<{ method: string; path: string; hx: string | null; body: string }> = [];
const host = Bun.serve({
  port: 0,
  fetch: async (request) => {
    if (new URL(request.url).pathname === "/redirect")
      return new Response(null, { status: 302, headers: { location: "/contacts" } });
    if (new URL(request.url).pathname === "/external-redirect")
      return new Response(null, { status: 302, headers: { location: "https://example.com/" } });
    requests.push({
      method: request.method,
      path: new URL(request.url).pathname,
      hx: request.headers.get("hx-request"),
      body: await request.text(),
    });
    return new Response(
      '<main><img src="/static/icon.svg"><button hx-post="/save">Save</button></main>',
      {
        headers: { "content-type": "text/html" },
      },
    );
  },
});
afterAll(() => host.stop());

const app = new Hono();
app.route(
  "/api/html",
  createHtmlHostRouter(() => ({ root: ".", previewUrl: `http://127.0.0.1:${host.port}` })),
);

test("proxies htmx requests and rewrites host assets while preserving hx actions", async () => {
  const response = await app.request("http://localhost/api/html/host/contacts?q=Carson", {
    method: "POST",
    headers: { "HX-Request": "true", "content-type": "text/plain" },
    body: "search=Carson",
  });
  expect(response.status).toBe(200);
  expect(await response.text()).toContain('src="/api/html/host/static/icon.svg"');
  expect(requests.at(-1)).toEqual({
    method: "POST",
    path: "/contacts",
    hx: "true",
    body: "search=Carson",
  });
});

test("rejects a nonlocal preview target", async () => {
  const blocked = new Hono();
  blocked.route(
    "/api/html",
    createHtmlHostRouter(() => ({ root: ".", previewUrl: "http://example.com" })),
  );
  const response = await blocked.request("http://localhost/api/html/host/contacts");
  expect(response.status).toBe(400);
});

test("rewrites local redirects and does not follow external redirects", async () => {
  const local = await app.request("http://localhost/api/html/host/redirect");
  expect(local.status).toBe(302);
  expect(local.headers.get("location")).toBe("/api/html/host/contacts");
  const external = await app.request("http://localhost/api/html/host/external-redirect");
  expect(external.status).toBe(502);
});
