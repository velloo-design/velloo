import { existsSync } from "node:fs";
import { join } from "node:path";
import { HOST_FILES_PREFIX } from "@velloo/renderer";

/** Where a design keeps the app's own files — stylesheets and what they and its trees load. */
export const HOST_FILES_DIR = join("assets", "host");

const STORED_TYPES: Record<string, string> = {
  css: "text/css; charset=utf-8",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  svg: "image/svg+xml",
  woff2: "font/woff2",
};

/** The design's stored copy of the host file at `hostPath`, if it keeps one. */
export function storedHostFile(root: string, hostPath: string): string | undefined {
  const parts = hostPath.split("/").filter(Boolean);
  if (parts.length === 0 || parts.some((part) => part === ".." || part === ".")) return undefined;
  const file = join(root, HOST_FILES_DIR, ...parts);
  return existsSync(file) ? file : undefined;
}

/**
 * Serve a design's stored host files under `HOST_FILES_PREFIX`, by the path the
 * app serves them at: answers any request under the prefix, null otherwise.
 * Only ever the design's own copies — never the running app, so a design looks
 * the same to everyone who opens it.
 */
export function hostFilesFetch(root: () => string): (request: Request) => Promise<Response> | null {
  return (request) => {
    const url = new URL(request.url);
    if (!url.pathname.startsWith(`${HOST_FILES_PREFIX}/`)) return null;
    return (async () => {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return new Response("method not allowed", { status: 405 });
      }
      let hostPath: string;
      try {
        hostPath = decodeURIComponent(url.pathname.slice(HOST_FILES_PREFIX.length));
      } catch {
        return new Response("Invalid host path", { status: 400 });
      }
      const file = storedHostFile(root(), hostPath);
      const type = file ? STORED_TYPES[file.split(".").pop()?.toLowerCase() ?? ""] : undefined;
      if (!file || !type) {
        return new Response(
          `The design keeps no copy of ${hostPath}. store_host_files copies the app's files into it.`,
          { status: 404 },
        );
      }
      return new Response(request.method === "HEAD" ? null : await Bun.file(file).arrayBuffer(), {
        headers: {
          "content-type": type,
          "x-content-type-options": "nosniff",
          "content-security-policy": "sandbox; script-src 'none'; object-src 'none'",
        },
      });
    })();
  };
}

/** Where design documents live: the canvas render route and the capture page. */
const DESIGN_DOCUMENT_PATHS = ["/api/render/", "/__velloo_capture/"];

/**
 * A design document asking for a root-relative URL nothing else answers
 * (`<img src="/static/logo.png">` in an `Html` node): in an HTML design that
 * path is the app's own, exactly as it will be once the markup ships — so
 * re-address it to the design's stored copy instead of 404ing on the daemon.
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
  if (url.pathname.startsWith(`${HOST_FILES_PREFIX}/`)) return null;
  url.pathname = `${HOST_FILES_PREFIX}${url.pathname}`;
  return new Request(url, request);
}
