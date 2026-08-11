import { Hono } from "hono";
import type { DesignFolder } from "./design-folder.ts";
import { createDesignRouter } from "./routes/api-design.ts";
import { createPageRouter } from "./routes/api-page.ts";
import { createRenderRouter } from "./routes/api-render.ts";

/**
 * Build the read-only Hono app. WS upgrade and static SPA serving are
 * attached at server bind time (in index.ts) since they need the Bun runtime.
 */
export function createApp(folder: () => DesignFolder): Hono {
  const app = new Hono();

  app.get("/api/health", (c) => c.json({ ok: true }));
  app.route("/api/design", createDesignRouter(folder));
  app.route("/api/page", createPageRouter(folder));
  app.route("/api/render", createRenderRouter(folder));

  return app;
}
