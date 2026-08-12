import { Hono } from "hono";
import type { DesignFolder } from "./design-folder.ts";
import type { MutationContext } from "./mutations/index.ts";
import { createComponentsRouter } from "./routes/api-components.ts";
import { createDesignRouter } from "./routes/api-design.ts";
import { createEmitRouter } from "./routes/api-emit.ts";
import { createInspectRouter } from "./routes/api-inspect.ts";
import { createMutateRouter } from "./routes/api-mutate.ts";
import { createPageRouter } from "./routes/api-page.ts";
import { createRenderRouter } from "./routes/api-render.ts";
import { createThemeRouter } from "./routes/api-theme.ts";
import { createUndoRouter } from "./routes/api-undo.ts";

/**
 * Build the Hono app. WS upgrade and static SPA serving are attached at
 * server bind time (in index.ts) since they need the Bun runtime.
 */
export function createApp(ctxFor: () => MutationContext): Hono {
  const app = new Hono();
  const folder: () => DesignFolder = () => ctxFor().folder;

  app.get("/api/health", (c) => c.json({ ok: true }));
  app.route("/api/design", createDesignRouter(folder));
  app.route("/api/page", createPageRouter(folder));
  app.route("/api/render", createRenderRouter(folder));
  app.route("/api/components", createComponentsRouter());
  app.route("/api/mutate", createMutateRouter(ctxFor));
  app.route("/api/inspect", createInspectRouter(ctxFor));
  app.route("/api/theme", createThemeRouter(ctxFor));
  app.route("/api/emit", createEmitRouter(folder));
  app.route(
    "/api/undo",
    createUndoRouter(folder, (e) => ctxFor().broadcast(e)),
  );

  return app;
}
