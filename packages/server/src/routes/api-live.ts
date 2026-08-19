import { Hono } from "hono";
import type { LiveBundler } from "../live/component-bundler.ts";

/**
 * Serve the live-island bundle the canvas iframe loads to mount real
 * host components into SSR markers. One folder-scoped module; the iframe
 * cache-busts with `?v=<bundler.version>` so a host edit re-fetches.
 *
 * A build error still serves a *valid* module (empty/partial `components`
 * plus `__velloo_live_error`) so the client falls back to the placeholder
 * skeleton and can surface the error instead of failing to import.
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
    });
  });

  return r;
}
