import { join, sep } from "node:path";

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
): Promise<T> {
  const assetsRoot = join(folder, "assets");
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url);
      if (liveCode !== null && url.pathname === "/live/bundle.js") {
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
      return new Response("not found", { status: 404 });
    },
  });
  try {
    return await fn(`http://127.0.0.1:${server.port}/`);
  } finally {
    server.stop(true);
  }
}
