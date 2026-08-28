import { Hono } from "hono";
import { activityLog } from "./activity.ts";
import type { CanvasAuth } from "./cloud.ts";
import type { DesignFolder } from "./design-folder.ts";
import type { CanvasBundler } from "./live/canvas-bundler.ts";
import type { LiveBundler } from "./live/component-bundler.ts";
import type { MutationContext } from "./mutations/index.ts";
import { createAuthRouter } from "./routes/auth.ts";
import { createCanvasRouter, createLiveRouter } from "./routes/bundles.ts";
import {
  createBoardRouter,
  createComponentsRouter,
  createDesignRouter,
  createScreenRouter,
  createSnippetsRouter,
} from "./routes/design.ts";
import { createExportRouter } from "./routes/export.ts";
import { createAnnotationsRouter, createNotesRouter } from "./routes/markup.ts";
import { createMutateRouter } from "./routes/mutate.ts";
import { createRenderRouter } from "./routes/render.ts";
import { createSearchRouter } from "./routes/search.ts";
import { createThemeRouter } from "./routes/theme.ts";
import { createUndoRouter } from "./routes/undo.ts";
import { localOnlyMiddleware } from "./security.ts";
import type { TailwindJit } from "./styles/tailwind-jit.ts";

/**
 * Build the Hono app. WS upgrade and static SPA serving are attached at
 * server bind time (in index.ts) since they need the Bun runtime.
 */
export function createApp(
  ctxFor: () => MutationContext,
  jit: TailwindJit,
  bundler: LiveBundler,
  canvasBundler: CanvasBundler,
  auth?: CanvasAuth,
): Hono {
  const app = new Hono();
  const folder: () => DesignFolder = () => ctxFor().folder;

  // The daemon is unauthenticated and loopback-bound; reject anything that
  // isn't a genuinely local request so a browser page (cross-origin POST or
  // DNS-rebinding) can't drive the API. See security.ts.
  app.use("*", localOnlyMiddleware());

  // Identity, not just liveness: `ensureDaemon` confirms a process answering
  // on a port is *our* daemon for *this* folder before attaching to it.
  app.get("/api/health", (c) =>
    c.json({ ok: true, app: "velloo", root: ctxFor().folder.root, pid: process.pid }),
  );
  // Recent agent/canvas activity — the bounded in-memory log the canvas
  // backfills from on open; live entries ride the WS as `activity` events.
  app.get("/api/activity", (c) => c.json({ events: activityLog(ctxFor().folder.root) }));
  app.route("/api/design", createDesignRouter(ctxFor));
  app.route("/api/screen", createScreenRouter(folder));
  app.route("/api/board", createBoardRouter(folder));
  app.route("/api/snippets", createSnippetsRouter(folder));
  app.route("/api/search", createSearchRouter(folder));
  app.route("/api/render", createRenderRouter(ctxFor, jit, bundler, canvasBundler));
  app.route("/api/export", createExportRouter(ctxFor, jit, bundler, canvasBundler));
  app.route("/api/live", createLiveRouter(bundler));
  app.route(
    "/api/canvas",
    createCanvasRouter(canvasBundler, () => ctxFor().folder.config.defaultLibrary),
  );
  app.route("/api/components", createComponentsRouter(ctxFor));
  app.route("/api/mutate", createMutateRouter(ctxFor));
  app.route("/api/theme", createThemeRouter(ctxFor));
  app.route("/api/annotations", createAnnotationsRouter(ctxFor));
  app.route("/api/notes", createNotesRouter(ctxFor));
  app.route("/api/auth", createAuthRouter(auth));
  app.route(
    "/api/undo",
    createUndoRouter(folder, (e) => ctxFor().broadcast(e)),
  );

  return app;
}
