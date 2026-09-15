import type { MiddlewareHandler } from "hono";

/**
 * The daemon binds to loopback and has no auth — it trusts that only local
 * processes reach it. Two browser-borne attacks break that assumption: a page
 * on any origin can issue a CORS-"simple" cross-origin POST to
 * `http://127.0.0.1:<port>/api/…` (no preflight), and DNS-rebinding can point a
 * hostile domain at 127.0.0.1 to gain same-origin read/write. Both are defeated
 * by requiring the request to look local: the `Host` header's hostname must be
 * loopback (rebinding sends the attacker's domain), and any `Origin` header must
 * also be loopback (a cross-site fetch carries the attacker's origin). Non-browser
 * callers (the CLI's daemon probe, tests) send a loopback Host and no Origin, so
 * they pass untouched.
 */
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/** Hostname portion of a `Host` header (strips the port, keeps IPv6 brackets). */
function hostHeaderHostname(host: string | null | undefined): string | null {
  if (!host) return null;
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    return end === -1 ? host : host.slice(0, end + 1);
  }
  const colon = host.lastIndexOf(":");
  return colon === -1 ? host : host.slice(0, colon);
}

/** Hostname of an `Origin` header, or null if absent/malformed. */
function originHostname(origin: string | null | undefined): string | null {
  if (origin == null) return null;
  try {
    return new URL(origin).hostname;
  } catch {
    return null;
  }
}

/**
 * True when the `Host` header names loopback. This alone defeats DNS rebinding,
 * which is the only way a foreign page can *read* a same-origin response. It is
 * the right check for static reads (assets, the SPA) that a headless screenshot
 * page loads with an opaque `Origin: null`; anything that mutates or streams
 * state needs the full {@link requestIsLocal}.
 */
export function hostIsLoopback(host: string | null | undefined): boolean {
  const hostname = hostHeaderHostname(host);
  return hostname !== null && LOOPBACK_HOSTS.has(hostname);
}

/**
 * True when a request is a genuine local one: loopback `Host`, and (if the
 * browser sent an `Origin`) a loopback origin too. A missing Host, a non-loopback
 * Host, a present-but-non-loopback Origin, or a malformed/`null` Origin all fail.
 */
export function requestIsLocal(headers: {
  host: string | null | undefined;
  origin: string | null | undefined;
}): boolean {
  if (!hostIsLoopback(headers.host)) return false;
  if (headers.origin != null) {
    const origin = originHostname(headers.origin);
    if (!origin || !LOOPBACK_HOSTS.has(origin)) return false;
  }
  return true;
}

/** Hono middleware that rejects any request that isn't local (see requestIsLocal). */
export function localOnlyMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    // Bun builds `req.url` from the Host header (or bound address), so its host
    // is the reliable signal — and unlike the forbidden `Host` header it's
    // populated on synthetic test Requests too.
    if (!requestIsLocal({ host: new URL(c.req.url).host, origin: c.req.header("origin") })) {
      return c.json({ error: "forbidden: request is not from a local origin" }, 403);
    }
    return next();
  };
}
