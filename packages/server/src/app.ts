import { Hono } from "hono";
import type { DesignFolder } from "./design-folder.ts";
import type { CanvasBundler } from "./live/canvas-bundler.ts";
import type { LiveBundler } from "./live/component-bundler.ts";
import type { MutationContext } from "./mutations/index.ts";
import { createAnnotationsRouter } from "./routes/api-annotations.ts";
import { createBoardRouter } from "./routes/api-board.ts";
import { createCanvasRouter } from "./routes/api-canvas.ts";
import { createComponentsRouter } from "./routes/api-components.ts";
import { createDesignRouter } from "./routes/api-design.ts";
import { createEmitRouter } from "./routes/api-emit.ts";
import { createInspectRouter } from "./routes/api-inspect.ts";
import { createLiveRouter } from "./routes/api-live.ts";
import { createMutateRouter } from "./routes/api-mutate.ts";
import { createNotesRouter } from "./routes/api-notes.ts";
import { createRenderRouter } from "./routes/api-render.ts";
import { createScreenRouter } from "./routes/api-screen.ts";
import { createSnippetsRouter } from "./routes/api-snippets.ts";
import { createThemeRouter } from "./routes/api-theme.ts";
import { createUndoRouter } from "./routes/api-undo.ts";
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
): Hono {
  const app = new Hono();
  const folder: () => DesignFolder = () => ctxFor().folder;

  // Identity, not just liveness: `ensureDaemon` confirms a process answering
  // on a port is *our* daemon for *this* folder before attaching to it.
  app.get("/api/health", (c) =>
    c.json({ ok: true, app: "velloo", root: ctxFor().folder.root, pid: process.pid }),
  );
  app.route("/api/design", createDesignRouter(ctxFor));
  app.route("/api/screen", createScreenRouter(folder));
  app.route("/api/board", createBoardRouter(folder));
  app.route("/api/snippets", createSnippetsRouter(folder));
  app.route("/api/render", createRenderRouter(ctxFor, jit, bundler));
  app.route("/api/live", createLiveRouter(bundler));
  app.route("/api/canvas", createCanvasRouter(canvasBundler));
  app.route("/api/components", createComponentsRouter(ctxFor));
  app.route("/api/mutate", createMutateRouter(ctxFor));
  app.route("/api/inspect", createInspectRouter(ctxFor));
  app.route("/api/theme", createThemeRouter(ctxFor));
  app.route("/api/emit", createEmitRouter(folder));
  app.route("/api/annotations", createAnnotationsRouter(ctxFor));
  app.route("/api/notes", createNotesRouter(ctxFor));
  app.route(
    "/api/undo",
    createUndoRouter(folder, (e) => ctxFor().broadcast(e)),
  );

  return app;
}
