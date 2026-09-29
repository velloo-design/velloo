import type { ComponentProvider, FrameworkAdapter } from "@velloo/provider";
import { HOST_PROXY_PREFIX, HOST_ROUTES_BASE, HTMX_RUNTIME_PATH } from "@velloo/renderer";
import type { HostApp } from "@velloo/schema";
import { Hono } from "hono";
import { HostSession } from "./host-session.ts";

const REQUEST_HEADERS = [
  "accept",
  "content-type",
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
  "hx-location",
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

/**
 * `hostApp.previewUrl` as a URL, when it is one Velloo may fetch from: http(s)
 * on this machine. A design folder is repository content, so its config must
 * not be able to point Velloo's requests at the network.
 */
export function localHostOrigin(previewUrl: string | undefined): URL | null {
  if (!previewUrl) return null;
  try {
    const url = new URL(previewUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return LOCAL_HOSTS.has(url.hostname) ? url : null;
  } catch {
    return null;
  }
}

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
  /** The app session requests to `origin` carry; in memory when omitted. */
  sessionFor?: (origin: string) => HostSession;
  /** Called when the app signs the session in or out, so frames can reload. */
  onSessionChange?: () => void;
  /**
   * The design's stored copy of a host file (a snapshot keeps them), served
   * when the app isn't reachable: an absolute path, or undefined without one.
   */
  storedCopy?: (hostPath: string) => string | undefined;
}

const STORED_TYPES: Record<string, string> = {
  css: "text/css; charset=utf-8",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  svg: "image/svg+xml",
  woff2: "font/woff2",
};

/**
 * The daemon's side of a host runtime: the htmx script, and a reverse proxy to
 * the app at `hostApp.previewUrl` under `HOST_PROXY_PREFIX` — so fragments load
 * same-origin with the design and htmx's `selfRequestsOnly` holds. Mount it at
 * `HOST_ROUTES_BASE`.
 */
export function createHtmlHostRouter(opts: HtmlHostOptions): Hono {
  const router = new Hono();
  const sessions = new Map<string, HostSession>();
  const sessionFor =
    opts.sessionFor ??
    ((origin: string) => {
      let session = sessions.get(origin);
      if (!session) {
        session = new HostSession();
        sessions.set(origin, session);
      }
      return session;
    });
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
    const dest = c.req.header("sec-fetch-dest");
    if (
      c.req.header("sec-fetch-mode") === "navigate" ||
      /^(?:document|iframe|frame|object|embed)$/.test(dest ?? "")
    ) {
      return c.text("The host proxy serves the canvas's requests, not pages to open.", 403);
    }
    const requestUrl = new URL(c.req.url);
    if (!requestUrl.pathname.startsWith(`${HOST_PROXY_PREFIX}/`)) {
      return c.text("Invalid host path", 400);
    }
    const hostPath = requestUrl.pathname.slice(HOST_PROXY_PREFIX.length);
    if (hostPath.startsWith("//")) return c.text("Invalid host path", 400);
    // With no app to ask, a snapshot's stylesheets and images come from the
    // copies the design keeps — so it looks the same on a fresh clone.
    const stored = async (): Promise<Response | null> => {
      if (c.req.method !== "GET" && c.req.method !== "HEAD") return null;
      const file = opts.storedCopy?.(decodeURIComponent(hostPath));
      const type = file ? STORED_TYPES[file.split(".").pop()?.toLowerCase() ?? ""] : undefined;
      if (!file || !type) return null;
      return new Response(await Bun.file(file).arrayBuffer(), {
        headers: {
          "content-type": type,
          "x-content-type-options": "nosniff",
          "content-security-policy": "sandbox; script-src 'none'; object-src 'none'",
        },
      });
    };
    const origin = opts.hostApp()?.previewUrl;
    if (!origin) {
      return (
        (await stored()) ??
        c.text("Set hostApp.previewUrl in .design/config.json to preview live HTML fragments.", 503)
      );
    }
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
    const session = sessionFor(url.origin);
    const cookie = session.header();
    if (cookie) headers.set("cookie", cookie);
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
      const copy = await stored();
      if (copy) return copy;
      return c.text(
        `Nothing answered at ${url.origin} (${error instanceof Error ? error.message : String(error)}). Start the app there, or set hostApp.previewUrl in .design/config.json to where it runs and restart the canvas.`,
        502,
      );
    }

    // The host's pages are content for the canvas, fetched by htmx and
    // linked as CSS and images — never a document on the daemon's origin,
    // where the app's own scripts (or an XSS in it) would hold the daemon's
    // API. Browsers ignore CSP on fetched and linked responses, so these cost
    // the canvas nothing.
    const outgoing = new Headers({
      "x-content-type-options": "nosniff",
      "content-security-policy": "sandbox; script-src 'none'; object-src 'none'",
    });
    for (const name of RESPONSE_HEADERS) {
      const value = response.headers.get(name);
      if (value) outgoing.set(name, value);
    }
    if (session.absorb(response.headers.getSetCookie())) opts.onSessionChange?.();
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
