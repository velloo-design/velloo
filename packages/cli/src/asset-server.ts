import { join, sep } from "node:path";
import { hostAssetRequest } from "@velloo/server";

/** Where the asset server answers with the live-island module; a capture page's `liveBundleUrl`. */
export const LIVE_BUNDLE_PATH = "/live/bundle.js";

/**
 * Ephemeral static server for headless capture passes (`velloo publish`,
 * headless render/export): rendered documents reference the folder's `/assets/…` (and
 * the live-island bundle) by root-relative URL, which in the daemon resolve
 * against the canvas server. One-shot commands have no canvas running, so
 * serve them ourselves for the duration and hand the origin to
 * `renderScreen` as `<base href>`.
 */
export async function withAssetServer<T>(
  folder: string,
  liveCode: string | null,
  fn: (baseHref: string) => Promise<T>,
  routes: {
    /** Answers a client-mount bundle request (the app's own components); null ⇒ not handled. */
    bundle?: ((url: URL) => Promise<string | null>) | undefined;
    /** The design's stored host files (HTML designs); null ⇒ not a host-files route. */
    host?: ((request: Request) => Promise<Response> | null) | undefined;
  } = {},
): Promise<T> {
  const { bundle, host } = routes;
  const assetsRoot = join(folder, "assets");
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url);
      const stored = host?.(req);
      if (stored) return stored;
      const mounted = bundle ? await bundle(url) : null;
      if (mounted !== null) {
        return new Response(mounted, {
          headers: { "Content-Type": "text/javascript", "Access-Control-Allow-Origin": "*" },
        });
      }
      if (liveCode !== null && url.pathname === LIVE_BUNDLE_PATH) {
        return new Response(liveCode, { headers: { "Content-Type": "text/javascript" } });
      }
      if (url.pathname.startsWith("/assets/")) {
        const fsPath = join(folder, decodeURIComponent(url.pathname));
        // Trailing sep so `/assets/../assets-foo/x` can't escape into a sibling
        // directory whose name is prefixed "assets".
        if (fsPath.startsWith(assetsRoot + sep)) {
          const file = Bun.file(fsPath);
          if (await file.exists()) return new Response(file);
        }
      }
      // A root-relative URL in an HTML design is the app's own file: its stored copy.
      const hostAsset = host && hostAssetRequest(req);
      const fromHost = hostAsset ? host(hostAsset) : null;
      if (fromHost) return fromHost;
      return new Response("not found", { status: 404 });
    },
  });
  try {
    return await fn(`http://127.0.0.1:${server.port}/`);
  } finally {
    server.stop(true);
  }
}
