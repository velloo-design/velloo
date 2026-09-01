import { existsSync } from "node:fs";
import { extname, join, sep } from "node:path";
import { canvasDistPath } from "@velloo/canvas";
import { keyframesToCss } from "@velloo/codegen";
import type { FrameworkAdapter } from "@velloo/provider";
import type { ServerWebSocket } from "bun";
import type { ActivityEvent } from "./activity.ts";
import { createApp } from "./app.ts";
import { Broadcaster } from "./broadcaster.ts";
import type { CanvasAuth, CanvasPublish, CloudAuth } from "./cloud.ts";
import { pullComments } from "./cloud-comments.ts";
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
import { ASSET_MIME } from "./fs.ts";
import { CanvasBundler } from "./live/canvas-bundler.ts";
import { LiveBundler, liveExtensions } from "./live/component-bundler.ts";
import {
  createMcpServer,
  createStdioMcpServer,
  type McpServerHandle,
  type StdioMcpServerHandle,
} from "./mcp/server.ts";
import type { MutationContext } from "./mutations/index.ts";
import { resolveProviders } from "./providers.ts";
import { PublishRunner } from "./publish-run.ts";
import { requestIsLocal } from "./security.ts";
import { findHostTailwindConfig } from "./styles/host-tailwind-config.ts";
import { TailwindJit } from "./styles/tailwind-jit.ts";
import { type WatchEvent, type Watcher, watchDesignFolder } from "./watcher.ts";

/**
 * How (and whether) to attach an MCP server. Omit for a canvas-only server
 * (`velloo run`). `http` listens on its own port; `stdio` binds this process's
 * stdin/stdout, so the process must be agent-spawned and keep stdout clean.
 */
export type McpTransportOptions = { transport: "http"; port?: number } | { transport: "stdio" };

export interface ServerOptions {
  folder: string;
  /** Canvas port. Default 7300; pass 0 for an OS-assigned free port. */
  port?: number;
  host?: string;
  /** Attach an MCP server to this process. Omit for canvas only. */
  mcp?: McpTransportOptions;
  /**
   * velloo-cloud credentials, resolved by the CLI from
   * `~/.velloo/credentials.json`. Enables the opt-in `send_feedback` tool.
   */
  cloud?: CloudAuth;
  /**
   * Live login state + logout for the canvas account menu, provided by the CLI.
   * Omit ⇒ the canvas reports logged out.
   */
  auth?: CanvasAuth;
  /**
   * Publish-to-cloud for the canvas, provided by the CLI (it owns the
   * credential and the cloud transport). Omit ⇒ the canvas can't publish.
   */
  publish?: CanvasPublish;
}

export interface ServerHandle {
  url: string;
  port: number;
  /** Present only when an HTTP MCP transport was attached. */
  mcpUrl?: string;
  mcpPort?: number;
  /** Live client counts (canvas WS + MCP sessions) for idle-shutdown decisions. */
  connections(): { canvas: number; mcp: number };
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
  if (
    !(fsPath === canvasDistPath || fsPath.startsWith(canvasDistPath + sep)) ||
    !existsSync(fsPath)
  )
    return null;
  const file = Bun.file(fsPath);
  if (!(await file.exists())) return null;
  const type = MIME[extname(fsPath)] ?? "application/octet-stream";
  return new Response(file, { headers: { "Content-Type": type } });
}

/**
 * Mirror the folder themes' font roles and raw color palette into a Tailwind
 * @theme block so `font-<role>` and scale/role color utilities (`bg-primary-600`,
 * `text-success-500`) compile. Values are overridden at render time by
 * themeToCss's :root vars; the JIT only needs the token to exist so the
 * utility is generated when a className references it.
 */
export function extraThemeBlock(folder: DesignFolder): string {
  // Merge across every named theme so utilities compile for whichever theme a
  // board renders with — values are overridden per render by themeToCss.
  const fonts: Record<string, string> = {};
  const palette: Record<string, string> = {};
  const spacing: Record<string, string> = {};
  const shadows: Record<string, string> = {};
  const animation: Record<string, string> = {};
  const keyframes: Record<string, Record<string, Record<string, string>>> = {};
  for (const theme of folder.themes.values()) {
    for (const [role, stack] of Object.entries(theme.typography.fontFamily ?? {})) {
      fonts[role] = stack;
    }
    for (const [name, value] of Object.entries(theme.palette ?? {})) palette[name] = value;
    // A name defined only in dark still needs its utility generated; the light
    // value is a placeholder the render-time :root/.dark vars override.
    for (const [name, value] of Object.entries(theme.paletteDark ?? {})) palette[name] ??= value;
    // Named spacing tokens (`--spacing-icon-rail`) make `w-icon-rail` / `h-header`
    // / `p-sidebar` compile — Tailwind v4 derives every spacing utility from them.
    // Skip the numeric scale (0/1/2/…): it's built in and would shadow it unitless.
    for (const [name, value] of Object.entries(theme.spacing ?? {})) {
      if (!Number.isNaN(Number(name))) continue;
      if (typeof value === "string" || typeof value === "number") spacing[name] = String(value);
    }
    for (const [name, value] of Object.entries(theme.shadows ?? {})) {
      if (typeof value === "string" || typeof value === "number") shadows[name] = String(value);
    }
    for (const [name, value] of Object.entries(theme.animation ?? {})) animation[name] = value;
    for (const [name, steps] of Object.entries(theme.keyframes ?? {})) keyframes[name] = steps;
  }
  const lines = [
    ...Object.entries(fonts).map(([role, stack]) => `  --font-${role}: ${stack};`),
    ...Object.entries(palette).map(([name, value]) => `  --color-${name}: ${value};`),
    ...Object.entries(spacing).map(([name, value]) => `  --spacing-${name}: ${value};`),
    ...Object.entries(shadows).map(([name, value]) => `  --shadow-${name}: ${value};`),
    ...Object.entries(animation).map(([name, value]) => `  --animate-${name}: ${value};`),
  ];
  const keyframesCss = keyframesToCss(
    Object.keys(keyframes).length > 0 ? keyframes : undefined,
    "  ",
  );
  if (lines.length === 0 && keyframesCss === "") return "";
  return `@theme {\n${[...lines, keyframesCss].filter(Boolean).join("\n")}\n}`;
}

/**
 * Serve the design folder's assets/ directory at /assets/*.
 *
 * Null on a miss, because /assets/ is a SHARED namespace: the canvas's own
 * Vite bundles ship at /assets/index-*.js, so anything not found here has to
 * fall through to the dist handler. `serveNonApi` turns the eventual miss into
 * a 404.
 */
export async function serveFolderAsset(req: Request, folderRoot: string): Promise<Response | null> {
  const url = new URL(req.url);
  if (!url.pathname.startsWith("/assets/")) return null;
  const fsPath = join(folderRoot, decodeURIComponent(url.pathname));
  if (!fsPath.startsWith(join(folderRoot, "assets") + sep)) return null;
  const file = Bun.file(fsPath);
  if (!(await file.exists())) return null;
  // Folder assets are restricted to image/font types on write (fs.ts allowlist);
  // anything else pre-dating the allowlist (or hand-placed) is served inert as a
  // download, never as active content (text/html, text/javascript) from the
  // canvas origin.
  const assetType = ASSET_MIME[extname(fsPath).toLowerCase()];
  const headers: Record<string, string> = {
    "Content-Type": assetType ?? "application/octet-stream",
    "X-Content-Type-Options": "nosniff",
  };
  if (!assetType) {
    headers["Content-Disposition"] = "attachment";
  }
  // Assets share the canvas origin, and an SVG *navigated to directly* is a
  // document whose scripts would run there. `<img>`/CSS embedding never runs
  // script, so a script-inert CSP costs nothing and closes the direct path —
  // for cloud-generated art (sanitized upstream, re-checked in
  // cloud-generate.ts) and anything else that lands in assets/.
  if (assetType === "image/svg+xml") {
    headers["Content-Security-Policy"] = "script-src 'none'";
  }
  return new Response(file, { headers });
}

/**
 * Everything that isn't /api/*: the folder's assets, then the canvas bundle,
 * then the SPA.
 *
 * The last step is why this is one function. /assets/* is a file namespace,
 * not an app route, so a miss there must be a 404 — falling through to the SPA
 * answered 200 with index.html, which an `<img>` renders as a broken image
 * indistinguishable from a corrupt file, and which makes any existence check
 * (a deleted asset, a typo'd src) silently succeed.
 */
export async function serveNonApi(req: Request, folderRoot: string): Promise<Response> {
  const assetResponse = await serveFolderAsset(req, folderRoot);
  if (assetResponse) return assetResponse;

  const staticResponse = await serveStatic(req);
  if (staticResponse) return staticResponse;

  if (new URL(req.url).pathname.startsWith("/assets/")) {
    return new Response("asset not found", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  if (req.method === "GET") return serveSpaFallback();
  return new Response("Not found", { status: 404 });
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

/** Cadence of the share-link comment pull while the daemon lives. */
const COMMENT_SYNC_INTERVAL_MS = 5 * 60_000;

export async function createServer(opts: ServerOptions): Promise<ServerHandle> {
  const folder: DesignFolder = await loadDesignFolder(opts.folder);
  const { providers, defaultProvider } = await resolveProviders(folder.config, folder.root);
  const broadcaster = new Broadcaster();
  const bundler = new LiveBundler(
    folder.root,
    () => folder.config,
    () => liveExtensions(folder.config.extensions),
  );
  const canvasBundler = new CanvasBundler(
    folder.root,
    () => folder.config.hostApp,
    (libraryId) => (providers[libraryId] as FrameworkAdapter | undefined)?.canvasBundleSpec,
  );
  const jit = new TailwindJit(
    Object.values(providers),
    join(folder.root, "screens"),
    undefined,
    () => extraThemeBlock(folder),
    () => bundler.hostSourceDirs(),
    () => findHostTailwindConfig(folder.root, folder.config.hostApp),
    folder.config.styling?.framework,
  );
  const broadcast = (e: WatchEvent | ActivityEvent) => {
    if (e.type === "screen-changed" || e.type === "theme-changed" || e.type === "snippet-changed") {
      jit.invalidate();
    }
    // A live extension was added/updated/removed — rebuild the bundle and
    // bump its version so the iframe re-fetches, and rescan Tailwind so the
    // new host component's utility classes compile. A folder-wide reload
    // (git revert-all) may have touched any of that, so it invalidates too.
    if (e.type === "config-changed" || e.type === "folder-reloaded") {
      bundler.invalidate();
      canvasBundler.invalidate();
      jit.invalidate();
    }
    broadcaster.broadcast(e);
  };
  const ctx: MutationContext = {
    folder,
    providers,
    defaultProvider,
    broadcast,
  };
  // Publishing borrows the daemon's warm pipeline — same folder, same resolved
  // providers, same compiled Tailwind the canvas is already rendering with.
  const publishRunner = opts.publish
    ? new PublishRunner(opts.publish, () => ({
        folder,
        providers,
        defaultProvider,
        snapshotCss: () => jit.build(),
      }))
    : undefined;
  const app = createApp(
    () => ctx,
    jit,
    bundler,
    canvasBundler,
    opts.auth,
    publishRunner,
    opts.cloud,
  );

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
        // Same loopback guard as the API: a cross-origin page must not be able
        // to open the broadcast channel and observe design-change events.
        if (!requestIsLocal({ host: url.host, origin: req.headers.get("origin") })) {
          return new Response("forbidden", { status: 403 });
        }
        if (srv.upgrade(req, { data: {} })) return undefined;
        return new Response("expected websocket upgrade", { status: 400 });
      }

      if (url.pathname.startsWith("/api/")) {
        return app.fetch(req);
      }

      return serveNonApi(req, folder.root);
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
  const assetOrigin = `http://${opts.host ?? "127.0.0.1"}:${port}/`;

  // Share-link comment sync: pull at boot, then on a slow cadence
  // while the daemon lives. Logged-out / unpublished / offline are quiet
  // no-ops inside pullComments — the folder keeps working fully offline; the
  // one-line log fires only when something actually synced.
  let commentTimer: ReturnType<typeof setInterval> | null = null;
  if (opts.cloud) {
    const cloud = opts.cloud;
    const sync = async () => {
      try {
        const s = await pullComments(ctx, cloud);
        if (s.status === "ok" && s.pulled + s.resolvedUp + s.resolvedDown > 0) {
          console.error(
            `velloo: share-link comments — ${s.pulled} pulled, ${s.resolvedUp} resolved up, ${s.resolvedDown} resolved down, ${s.unresolvedTotal} unresolved waiting`,
          );
        }
        if (s.status === "ok" && s.note) console.error(`velloo: ${s.note}`);
      } catch {
        // sync must never break the server
      }
    };
    void sync();
    commentTimer = setInterval(() => void sync(), COMMENT_SYNC_INTERVAL_MS);
  }

  // MCP is optional and transport-pluggable. `velloo run` omits it (canvas
  // only); `velloo mcp` attaches stdio (default) or HTTP. Either way the MCP
  // reuses this ctx/jit/bundler, so screenshots resolve /assets against the
  // canvas above.
  let httpMcp: McpServerHandle | undefined;
  let stdioMcp: StdioMcpServerHandle | undefined;
  if (opts.mcp?.transport === "http") {
    httpMcp = await createMcpServer(ctx, {
      port: opts.mcp.port ?? 7301,
      host: opts.host ?? "127.0.0.1",
      jit,
      bundler,
      canvasBundler,
      assetOrigin,
      cloud: opts.cloud,
    });
  } else if (opts.mcp?.transport === "stdio") {
    stdioMcp = await createStdioMcpServer(ctx, {
      jit,
      bundler,
      canvasBundler,
      assetOrigin,
      cloud: opts.cloud,
    });
  }

  return {
    url: `http://${server.hostname}:${port}`,
    port,
    mcpUrl: httpMcp?.url,
    mcpPort: httpMcp?.port,
    connections: () => ({ canvas: broadcaster.size(), mcp: httpMcp?.sessions() ?? 0 }),
    async close() {
      if (commentTimer) clearInterval(commentTimer);
      watcher?.close();
      await httpMcp?.close();
      await stdioMcp?.close();
      server.stop(true);
    },
  };
}

export type {
  CanvasAccount,
  CanvasAuth,
  CanvasAuthStatus,
  CanvasLogin,
  CanvasPublish,
  CanvasPublishProgress,
  CanvasPublishRequest,
  CanvasPublishResult,
  CloudAuth,
  PublishHost,
} from "./cloud.ts";
export {
  type CommentSyncContext,
  countUnresolvedPulledComments,
  type PullCommentsSummary,
  pullComments,
} from "./cloud-comments.ts";
export type { DesignFolder } from "./design-folder.ts";
export { loadDesignFolder, orderedBoards } from "./design-folder.ts";
export {
  type ExportFormat,
  type ExportMode,
  type ExportOptions,
  type ExportPipeline,
  exportBoardHtml,
  exportBoardPdf,
  exportBoardPng,
  exportFilename,
  exportFrameHtml,
  exportFramePdf,
  exportFramePng,
  exportScreenHtml,
  exportScreenPdf,
  exportScreenPng,
  findFrame,
} from "./export/core.ts";
export { STANDALONE_WARN_BYTES, type StandaloneResult } from "./export/standalone.ts";
// Re-export key types and helpers for downstream consumers.
export { registryForScreen, renderPassForScreen } from "./extensions/registry.ts";
export { topUpTokens } from "./feedback-tokens.ts";
export { writeJsonAtomic, writeText } from "./fs.ts";
export { hostAppRootFrom } from "./live/bundle-core.ts";
export { LiveBundler, liveExtensions } from "./live/component-bundler.ts";
export {
  type FormatGateUpgradeResult,
  runStdioFormatGate,
  type StdioFormatGateHandle,
} from "./mcp/format-gate.ts";
export { runStdioMcpProxy, type StdioMcpProxyHandle } from "./mcp/proxy.ts";
// Verification cores (dark-mode audit / class validation / contrast) — the
// same checks the MCP audit + validate_classes tools run, exported for
// headless consumers (`velloo ci`).
export {
  type DarkModeAuditResult,
  darkModeAuditTree,
} from "./mutations/dark-mode-audit.ts";
export { createServerProviderLoader, resolveProviders } from "./providers.ts";
export { type ClassReport, validateClassNames } from "./styles/class-validation.ts";
export { findHostTailwindConfig } from "./styles/host-tailwind-config.ts";
export { TailwindJit } from "./styles/tailwind-jit.ts";
export {
  type ContrastResult,
  scoreThemeContrast,
  scoreThemeContrastBoth,
} from "./theme/contrast.ts";
export { derivePalette } from "./theme/derive-palette.ts";
export type { WatchEvent } from "./watcher.ts";
