import { existsSync } from "node:fs";
import { extname, join } from "node:path";
import { canvasDistPath } from "@velloo/canvas";
import type { ServerWebSocket } from "bun";
import { createApp } from "./app.ts";
import { Broadcaster } from "./broadcaster.ts";
import {
  type DesignFolder,
  loadDesignFolder,
  reloadAnnotations,
  reloadNotes,
  reloadPage,
  reloadSnippet,
  reloadTheme,
} from "./design-folder.ts";
import { createMcpServer } from "./mcp/server.ts";
import type { MutationContext } from "./mutations/index.ts";
import { TailwindJit } from "./styles/tailwind-jit.ts";
import { type WatchEvent, type Watcher, watchDesignFolder } from "./watcher.ts";

export interface ServerOptions {
  folder: string;
  port?: number;
  host?: string;
  /** MCP server port. Default 7301. */
  mcpPort?: number;
}

export interface ServerHandle {
  url: string;
  mcpUrl: string;
  port: number;
  mcpPort: number;
  close(): Promise<void>;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
};

async function serveStatic(req: Request): Promise<Response | null> {
  const url = new URL(req.url);
  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const fsPath = join(canvasDistPath, requested);
  if (!fsPath.startsWith(canvasDistPath) || !existsSync(fsPath)) return null;
  const file = Bun.file(fsPath);
  if (!(await file.exists())) return null;
  const type = MIME[extname(fsPath)] ?? "application/octet-stream";
  return new Response(file, { headers: { "Content-Type": type } });
}

async function serveSpaFallback(): Promise<Response> {
  const indexPath = join(canvasDistPath, "index.html");
  const file = Bun.file(indexPath);
  if (await file.exists()) {
    return new Response(file, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }
  return new Response(
    "<!doctype html><h1>Velloo canvas not built</h1>" +
      "<p>Run <code>bun --cwd packages/canvas run build</code> from the repo root.</p>",
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

export async function createServer(opts: ServerOptions): Promise<ServerHandle> {
  const folder: DesignFolder = await loadDesignFolder(opts.folder);
  const broadcaster = new Broadcaster();
  const jit = new TailwindJit(join(folder.root, "pages"));
  // Any page edit may introduce a new className not in the cached output. Theme
  // edits don't touch class lists, but we drop the cache anyway for symmetry —
  // the Tailwind compile is cheap on a warm process.
  const broadcast = (e: WatchEvent) => {
    // Any of these can introduce new classes Tailwind hasn't compiled yet.
    if (e.type === "page-changed" || e.type === "theme-changed" || e.type === "snippet-changed") {
      jit.invalidate();
    }
    broadcaster.broadcast(e);
  };
  const ctx: MutationContext = { folder, broadcast };
  const app = createApp(() => ctx, jit);

  let watcher: Watcher | null = null;
  watcher = watchDesignFolder(folder.root, async (event) => {
    try {
      if (event.type === "page-changed") {
        await reloadPage(folder, event.pageId);
      } else if (event.type === "theme-changed") {
        await reloadTheme(folder);
      } else if (event.type === "snippet-changed") {
        await reloadSnippet(folder, event.snippetId);
      } else if (event.type === "annotations-changed") {
        await reloadAnnotations(folder, event.pageId);
      } else if (event.type === "notes-changed") {
        await reloadNotes(folder, event.pageId);
      }
      broadcast(event);
    } catch (err) {
      console.error("velloo: failed to reload after change:", err);
    }
  });

  const server = Bun.serve({
    port: opts.port ?? 7300,
    hostname: opts.host ?? "127.0.0.1",
    async fetch(req: Request, srv): Promise<Response | undefined> {
      const url = new URL(req.url);

      if (url.pathname === "/ws") {
        if (srv.upgrade(req, { data: {} })) return undefined;
        return new Response("expected websocket upgrade", { status: 400 });
      }

      if (url.pathname.startsWith("/api/")) {
        return app.fetch(req);
      }

      const staticResponse = await serveStatic(req);
      if (staticResponse) return staticResponse;

      if (req.method === "GET") return serveSpaFallback();

      return new Response("Not found", { status: 404 });
    },
    websocket: {
      open(ws: ServerWebSocket<unknown>) {
        broadcaster.register(ws);
      },
      close(ws: ServerWebSocket<unknown>) {
        broadcaster.unregister(ws);
      },
      message() {
        // Client-to-server WS messages are ignored; the channel is one-way.
      },
    },
  });

  const port = server.port ?? opts.port ?? 7300;

  // MCP server on a separate port (defaults to 7301).
  const mcp = await createMcpServer(ctx, {
    port: opts.mcpPort ?? 7301,
    host: opts.host ?? "127.0.0.1",
    jit,
  });

  return {
    url: `http://${server.hostname}:${port}`,
    mcpUrl: mcp.url,
    port,
    mcpPort: mcp.port,
    async close() {
      watcher?.close();
      await mcp.close();
      server.stop(true);
    },
  };
}

// Re-export key types and helpers for downstream consumers.
export type { DesignFolder } from "./design-folder.ts";
export { writeJsonAtomic, writeText } from "./fs.ts";
export { TailwindJit } from "./styles/tailwind-jit.ts";
export type { WatchEvent } from "./watcher.ts";
