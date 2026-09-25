import { htmxFilePath } from "@velloo/provider-html";
import type { HostApp } from "@velloo/schema";
import { Hono } from "hono";

const REQUEST_HEADERS = [
  "accept",
  "content-type",
  "cookie",
  "hx-request",
  "hx-target",
  "hx-trigger",
  "hx-trigger-name",
  "hx-current-url",
  "x-csrf-token",
];
const RESPONSE_HEADERS = [
  "content-type",
  "hx-trigger",
  "hx-redirect",
  "hx-refresh",
  "hx-reswap",
  "hx-retarget",
  "hx-push-url",
  "hx-replace-url",
];

export function createHtmlHostRouter(hostApp: () => HostApp | undefined): Hono {
  const router = new Hono();
  router.get("/htmx.js", async (c) => {
    const file = Bun.file(htmxFilePath);
    if (!(await file.exists())) return c.text("htmx runtime missing", 500);
    return c.body(await file.arrayBuffer(), 200, {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=86400",
    });
  });
  router.all("/host/*", async (c) => {
    const origin = hostApp()?.previewUrl;
    if (!origin)
      return c.text(
        "Set hostApp.previewUrl in .design/config.json to preview live HTML fragments.",
        503,
      );
    const suffix = c.req.path.slice("/api/html/host".length);
    if (!suffix.startsWith("/") || suffix.startsWith("//")) return c.text("Invalid host path", 400);
    const url = new URL(origin);
    if (!(["http:", "https:"] as string[]).includes(url.protocol))
      return c.text("Invalid host origin", 400);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
      return c.text("Host preview URL must be local", 400);
    url.pathname = suffix;
    url.search = new URL(c.req.url).search;
    const headers = new Headers();
    for (const name of REQUEST_HEADERS) {
      const value = c.req.header(name);
      if (value) headers.set(name, value);
    }
    let response: Response;
    try {
      response = await fetch(url, {
        method: c.req.method,
        headers,
        ...(c.req.method === "GET" || c.req.method === "HEAD"
          ? {}
          : { body: await c.req.arrayBuffer() }),
        redirect: "manual",
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      return c.text(
        `Host preview request failed: ${error instanceof Error ? error.message : String(error)}`,
        502,
      );
    }
    const outgoing = new Headers();
    for (const name of RESPONSE_HEADERS) {
      const value = response.headers.get(name);
      if (value) outgoing.set(name, value);
    }
    for (const cookie of response.headers.getSetCookie()) outgoing.append("set-cookie", cookie);
    const location = response.headers.get("location");
    if (location && response.status >= 300 && response.status < 400) {
      const destination = new URL(location, url);
      if (destination.origin !== url.origin) return c.text("Host redirect must stay local", 502);
      outgoing.set(
        "location",
        `/api/html/host${destination.pathname}${destination.search}${destination.hash}`,
      );
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("text/html")) {
      const html = (await response.text()).replace(
        /\b(src|poster)=(['"])\/(?!\/)([^'"<>]*)\2/gi,
        (_full, attribute: string, quote: string, path: string) =>
          `${attribute}=${quote}/api/html/host/${path}${quote}`,
      );
      return new Response(html, { status: response.status, headers: outgoing });
    }
    return new Response(response.body, { status: response.status, headers: outgoing });
  });
  return router;
}
