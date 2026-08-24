import { Hono } from "hono";
import type { CanvasBundler } from "../live/canvas-bundler.ts";
import type { LiveBundler } from "../live/component-bundler.ts";

/**
 * Serve the live-island bundle the canvas iframe loads to mount real
 * host components into SSR markers. One folder-scoped module; the iframe
 * cache-busts with `?v=<bundler.version>` so a host edit re-fetches.
 *
 * A build error still serves a *valid* module (empty/partial `components`
 * plus `__velloo_live_error`) so the client falls back to the placeholder
 * skeleton and can surface the error instead of failing to import.
 *
 * `Access-Control-Allow-Origin: *` is required, not cosmetic: the canvas
 * iframe loads same-origin, but the screenshot / `compare_to_url` path
 * renders via Playwright `setContent` (an opaque `null`-origin document
 * with `<base href>` pointing here). ES module imports are CORS-gated, so
 * without this header the cross-origin import is blocked and the capture
 * silently falls back to the placeholder — the live nodes wouldn't appear
 * in screenshots. The bundle is the user's own code on localhost, so a
 * wildcard origin is safe.
 */
export function createLiveRouter(bundler: LiveBundler): Hono {
  const r = new Hono();

  r.get("/bundle.js", async (c) => {
    const { code, errors } = await bundler.build();
    const body = errors.length
      ? `${code}\nexport const __velloo_live_error = ${JSON.stringify(errors)};\n`
      : code;
    return c.body(body, 200, {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    });
  });

  return r;
}

/**
 * Serve the framework-native canvas bundle (#18) the iframe loads to client-
 * render a screen against the host app's actually-installed components (exact
 * version). One folder-scoped `mountScreen` module; the iframe cache-busts with
 * `?v=<bundler.version>`. A build error (framework not installed, resolve
 * failure) still serves a valid module — the empty `mountScreen` stub — so the
 * client cleanly keeps the SSR render. `Access-Control-Allow-Origin: *` for the
 * same Playwright-`setContent` reason as the live bundle (see api-live.ts).
 */
export function createCanvasRouter(bundler: CanvasBundler): Hono {
  const r = new Hono();

  r.get("/bundle.js", async (c) => {
    const { code, errors } = await bundler.build();
    const body = errors.length
      ? `${code}\nexport const __velloo_canvas_error = ${JSON.stringify(errors)};\n`
      : code;
    return c.body(body, 200, {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    });
  });

  return r;
}
