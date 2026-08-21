import { Hono } from "hono";
import type { CanvasBundler } from "../live/canvas-bundler.ts";

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
