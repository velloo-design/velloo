import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  captureDir,
  deleteCapture,
  isSafeCaptureFile,
  isSafeCaptureId,
  listCaptures,
  readCaptureManifest,
} from "@velloo/renderer";
import { Hono } from "hono";
import type { DesignFolder } from "../design-folder.ts";

const CONTENT_TYPES: Record<string, string> = {
  png: "image/png",
  json: "application/json",
  mhtml: "multipart/related",
  svg: "image/svg+xml",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  css: "text/css",
};

function contentType(file: string): string {
  const ext = file.split(".").pop()?.toLowerCase() ?? "";
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

/**
 * Browser captures, served from the daemon's own origin.
 *
 * This is what lets `compare_to_url` diff a screen against a frozen snapshot
 * without touching its scheme guard: that tool deliberately rejects anything
 * but http(s) so `file://` and `chrome://` can't be rasterized and handed back,
 * and serving captures over HTTP means it needs no exception at all — a
 * capture is just a URL. Relative asset resolution comes along for free.
 *
 * Think of it as the durable form of the in-memory URL capture cache: `cacheUrl`
 * already freezes a dynamic page so similarity stops drifting between calls,
 * but it dies with the daemon. These survive restarts — and are listable and
 * deletable, because a capture holds real content from the user's app.
 *
 * Behind the same loopback trust boundary as every other daemon route.
 */
export function createCapturesRouter(folder: () => DesignFolder): Hono {
  const r = new Hono();
  const rootOf = (): { root: string; folderId?: string } => {
    const f = folder();
    const folderId = f.config.folderId;
    return folderId ? { root: f.root, folderId } : { root: f.root };
  };

  r.get("/", (c) => {
    const { root, folderId } = rootOf();
    return c.json({ captures: listCaptures(root, folderId) });
  });

  r.get("/:id", (c) => {
    const id = c.req.param("id");
    if (!isSafeCaptureId(id)) return c.json({ error: "bad capture id" }, 400);
    const { root, folderId } = rootOf();
    const manifest = readCaptureManifest(root, id, folderId);
    if (!manifest) return c.json({ error: "capture not found" }, 404);
    return c.json(manifest);
  });

  // Two segments so `assets/<file>` resolves; both are validated, and the join
  // only ever happens after both pass — a `..` never reaches the filesystem.
  r.get("/:id/:file{.+}", (c) => {
    const id = c.req.param("id");
    const rel = c.req.param("file");
    if (!isSafeCaptureId(id)) return c.json({ error: "bad capture id" }, 400);
    const parts = rel.split("/");
    if (parts.length > 2 || !parts.every((p) => isSafeCaptureFile(p))) {
      return c.json({ error: "bad capture file" }, 400);
    }
    const { root, folderId } = rootOf();
    try {
      const body = readFileSync(join(captureDir(root, id, folderId), ...parts));
      return c.body(new Uint8Array(body), 200, {
        "Content-Type": contentType(parts[parts.length - 1] ?? ""),
        "Cache-Control": "no-store",
      });
    } catch {
      return c.json({ error: "capture file not found" }, 404);
    }
  });

  r.delete("/:id", (c) => {
    const id = c.req.param("id");
    if (!isSafeCaptureId(id)) return c.json({ error: "bad capture id" }, 400);
    const { root, folderId } = rootOf();
    return deleteCapture(root, id, folderId)
      ? c.json({ ok: true, id })
      : c.json({ error: "capture not found" }, 404);
  });

  return r;
}
