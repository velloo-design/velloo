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
  reloadBoard,
  reloadNotes,
  reloadScreen,
  reloadSnippet,
  reloadTheme,
} from "./design-folder.ts";
import { createMcpServer } from "./mcp/server.ts";
import type { MutationContext } from "./mutations/index.ts";
import { migrateConfig, resolveProviders } from "./providers.ts";
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

/**
 * Mirror the folder theme's font roles into a Tailwind @theme block so
 * `font-<role>` utilities compile. Values are overridden at render time
 * by themeToCss's :root vars; the JIT only needs the token to exist.
 */
function fontThemeBlock(folder: DesignFolder): string {
  // Merge roles across every named theme so font-<role> utilities
  // compile for whichever theme a board renders with. Values are
  // overridden per render by themeToCss's :root vars.
  const merged: Record<string, string> = {};
  for (const theme of folder.themes.values()) {
    for (const [role, stack] of Object.entries(theme.typography.fontFamily ?? {})) {
      merged[role] = stack;
    }
  }
  if (Object.keys(merged).length === 0) return "";
  const lines = Object.entries(merged).map(([role, stack]) => `  --font-${role}: ${stack};`);
  return `@theme {\n${lines.join("\n")}\n}`;
}

/** Serve the design folder's assets/ directory at /assets/*. */
async function serveFolderAsset(req: Request, folderRoot: string): Promise<Response | null> {
  const url = new URL(req.url);
  if (!url.pathname.startsWith("/assets/")) return null;
  const fsPath = join(folderRoot, decodeURIComponent(url.pathname));
  if (!fsPath.startsWith(join(folderRoot, "assets"))) return null;
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
  // Promote legacy single-library configs to the Sprint-Y multi-library
  // shape in-memory so older Pulse folders keep working without
  // rewriting their config on disk. See providers.ts#migrateConfig.
  folder.config = migrateConfig(folder.config);
  const { providers, defaultProvider } = await resolveProviders(folder.config, folder.root);
  const broadcaster = new Broadcaster();
  const jit = new TailwindJit(
    Object.values(providers),
    join(folder.root, "screens"),
    undefined,
    () => fontThemeBlock(folder),
  );
  const broadcast = (e: WatchEvent) => {
    if (e.type === "screen-changed" || e.type === "theme-changed" || e.type === "snippet-changed") {
      jit.invalidate();
    }
    broadcaster.broadcast(e);
  };
  const ctx: MutationContext = {
    folder,
    providers,
    defaultProvider,
    provider: defaultProvider,
    broadcast,
  };
  const app = createApp(() => ctx, jit);

  let watcher: Watcher | null = null;
  watcher = watchDesignFolder(folder.root, async (event) => {
    try {
      if (event.type === "screen-changed") {
        await reloadScreen(folder, event.screenId);
      } else if (event.type === "board-changed") {
        await reloadBoard(folder, event.boardId);
      } else if (event.type === "theme-changed") {
        await reloadTheme(folder);
      } else if (event.type === "snippet-changed") {
        await reloadSnippet(folder, event.snippetId);
      } else if (event.type === "annotations-changed") {
        await reloadAnnotations(folder, event.screenId);
      } else if (event.type === "notes-changed") {
        await reloadNotes(folder, event.boardId);
      }
      broadcast(event);
    } catch (err) {
      console.error("velloo: failed to reload after change:", err);
      // The file on disk changed but the in-memory state didn't — tell
      // clients instead of letting them keep rendering stale state.
      broadcast({
        type: "reload-error",
        source: event.type,
        message: err instanceof Error ? err.message : String(err),
      });
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

      const assetResponse = await serveFolderAsset(req, folder.root);
      if (assetResponse) return assetResponse;

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
    assetOrigin: `http://${opts.host ?? "127.0.0.1"}:${server.port}/`,
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
export {
  createServerProviderLoader,
  DEFAULT_LEGACY_LIBRARY_ID,
  migrateConfig,
  migrateLibrarySource,
  resolveProviders,
} from "./providers.ts";
export { TailwindJit } from "./styles/tailwind-jit.ts";
export { derivePalette } from "./theme/derive-palette.ts";
export type { WatchEvent } from "./watcher.ts";
