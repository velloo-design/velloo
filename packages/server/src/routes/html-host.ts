import type { ComponentProvider, FrameworkAdapter } from "@velloo/provider";
import { HOST_PROXY_PREFIX, HOST_ROUTES_BASE, HTMX_RUNTIME_PATH } from "@velloo/renderer";
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
/** Attributes whose root-relative value names a host resource the page loads or navigates to. */
const HOST_URL_ATTRIBUTES = ["src", "href", "poster", "action", "formaction"];
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** The runtime script of the first provider that declares a host runtime. */
export function hostRuntimeScript(providers: Iterable<ComponentProvider>): string | undefined {
  for (const provider of providers) {
    const script = (provider as FrameworkAdapter).hostRuntime?.scriptPath;
    if (script) return script;
  }
  return undefined;
}

export interface HtmlHostOptions {
  hostApp: () => HostApp | undefined;
  /** The host runtime script of any adapter in the folder that declares one. */
  runtimeScript: () => string | undefined;
}

/**
 * The daemon's side of a host runtime: the htmx script, and a reverse proxy to
 * the app at `hostApp.previewUrl` under `HOST_PROXY_PREFIX` — so fragments load
 * same-origin with the design and htmx's `selfRequestsOnly` holds. Mount it at
 * `HOST_ROUTES_BASE`.
 */
export function createHtmlHostRouter(opts: HtmlHostOptions): Hono {
  const router = new Hono();
  // Routes relative to HOST_ROUTES_BASE, where the app mounts this router.
  router.get(HTMX_RUNTIME_PATH.slice(HOST_ROUTES_BASE.length), async (c) => {
    const path = opts.runtimeScript();
    const file = path ? Bun.file(path) : undefined;
    if (!file || !(await file.exists())) return c.text("htmx runtime missing", 404);
    return c.body(await file.arrayBuffer(), 200, {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=86400",
    });
  });
  router.all(`${HOST_PROXY_PREFIX.slice(HOST_ROUTES_BASE.length)}/*`, async (c) => {
    const origin = opts.hostApp()?.previewUrl;
    if (!origin) {
      return c.text(
        "Set hostApp.previewUrl in .design/config.json to preview live HTML fragments.",
        503,
      );
    }
    const requestUrl = new URL(c.req.url);
    if (!requestUrl.pathname.startsWith(`${HOST_PROXY_PREFIX}/`)) {
      return c.text("Invalid host path", 400);
    }
    const hostPath = requestUrl.pathname.slice(HOST_PROXY_PREFIX.length);
    if (hostPath.startsWith("//")) return c.text("Invalid host path", 400);
    const url = new URL(origin);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return c.text("Invalid host origin", 400);
    }
    if (!LOCAL_HOSTS.has(url.hostname)) return c.text("Host preview URL must be local", 400);
    url.pathname = hostPath;
    url.search = requestUrl.search;

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
    for (const cookie of response.headers.getSetCookie()) {
      outgoing.append("set-cookie", scopeCookieToProxy(cookie));
    }
    const location = response.headers.get("location");
    if (location && response.status >= 300 && response.status < 400) {
      const destination = new URL(location, url);
      if (destination.origin !== url.origin) return c.text("Host redirect must stay local", 502);
      outgoing.set(
        "location",
        `${HOST_PROXY_PREFIX}${destination.pathname}${destination.search}${destination.hash}`,
      );
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("text/css")) {
      return new Response(rerootCssUrls(await response.text()), {
        status: response.status,
        headers: outgoing,
      });
    }
    const proxied = new Response(response.body, { status: response.status, headers: outgoing });
    return contentType.includes("text/html") ? rerootHostUrls(proxied) : proxied;
  });
  return router;
}

/** Where design documents live: the canvas render route and the capture page. */
const DESIGN_DOCUMENT_PATHS = ["/api/render/", "/__velloo_capture/"];

/**
 * A design document asking for a root-relative URL nothing else answers
 * (`<img src="/static/logo.png">` in an `Html` node): in an HTML/htmx design
 * that path is the host app's, exactly as it will be once the markup ships —
 * so re-address it to the proxy instead of 404ing on the daemon.
 */
export function hostAssetRequest(request: Request): Request | null {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  const referer = request.headers.get("referer");
  if (!referer) return null;
  let from: string;
  try {
    from = new URL(referer).pathname;
  } catch {
    return null;
  }
  if (!DESIGN_DOCUMENT_PATHS.some((prefix) => from.startsWith(prefix))) return null;
  const url = new URL(request.url);
  if (url.pathname.startsWith(`${HOST_ROUTES_BASE}/`)) return null;
  url.pathname = `${HOST_PROXY_PREFIX}${url.pathname}`;
  return new Request(url, request);
}

/**
 * The host routes as a plain fetch handler, for the one-shot asset servers CLI
 * captures run on: answers anything under `HOST_ROUTES_BASE`, null otherwise.
 * Pair it with `hostAssetRequest` for the document's own root-relative URLs.
 */
export function htmlHostFetch(
  opts: HtmlHostOptions,
): (request: Request) => Promise<Response> | null {
  const app = new Hono().route(HOST_ROUTES_BASE, createHtmlHostRouter(opts));
  return (request) => {
    if (new URL(request.url).pathname.startsWith(`${HOST_ROUTES_BASE}/`)) {
      return Promise.resolve(app.fetch(request));
    }
    return null;
  };
}

/**
 * Keep a host cookie inside the proxy: its Path moves under the proxy prefix and
 * its Domain goes, so the browser only ever sends it back to the host — never
 * to the daemon's own routes.
 */
export function scopeCookieToProxy(cookie: string): string {
  const [pair = "", ...attributes] = cookie.split(";");
  let path = "/";
  const kept: string[] = [];
  for (const attribute of attributes) {
    const trimmed = attribute.trim();
    const separator = trimmed.indexOf("=");
    const key = (separator === -1 ? trimmed : trimmed.slice(0, separator)).toLowerCase();
    if (key === "domain") continue;
    if (key === "path") {
      path = separator === -1 ? "/" : trimmed.slice(separator + 1) || "/";
      continue;
    }
    if (trimmed) kept.push(trimmed);
  }
  const scoped = `${HOST_PROXY_PREFIX}${path.startsWith("/") ? path : `/${path}`}`;
  return [pair.trim(), `Path=${scoped}`, ...kept].join("; ");
}

/**
 * Re-root the host's root-relative URLs under the proxy with a real HTML parser
 * (attribute values, including `url(…)` in inline styles; not text or scripts).
 * `hx-*` attributes are left alone: the host runtime routes each request as it
 * is made, against the fragment it came from.
 */
const reroot = (value: string): string =>
  value.startsWith("/") && !value.startsWith("//") && !value.startsWith(`${HOST_PROXY_PREFIX}/`)
    ? `${HOST_PROXY_PREFIX}${value}`
    : value;

/** `url(/…)` in a stylesheet or a `style` attribute, re-rooted under the proxy. */
function rerootCssUrls(css: string): string {
  return css.replace(
    /url\(\s*(["']?)(\/[^"')\s]*)\1\s*\)/gi,
    (_match, quote: string, url: string) => `url(${quote}${reroot(url)}${quote})`,
  );
}

function rerootHostUrls(response: Response): Response {
  return new HTMLRewriter()
    .on("*", {
      element(element) {
        for (const name of HOST_URL_ATTRIBUTES) {
          const value = element.getAttribute(name);
          if (value !== null) element.setAttribute(name, reroot(value));
        }
        const style = element.getAttribute("style");
        if (style?.includes("url(")) element.setAttribute("style", rerootCssUrls(style));
        const srcset = element.getAttribute("srcset");
        if (srcset !== null) {
          element.setAttribute(
            "srcset",
            srcset
              .split(",")
              .map((candidate) => {
                const [url = "", ...descriptor] = candidate.trim().split(/\s+/);
                return [reroot(url), ...descriptor].join(" ");
              })
              .join(", "),
          );
        }
      },
    })
    .transform(response);
}
