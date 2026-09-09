import { Hono } from "hono";
import { type CanvasUpdates, UPDATES_UNAVAILABLE } from "../updates.ts";

/**
 * Canvas self-update backing. The CLI supplies the controller (it owns the
 * install method and the package manager); without one the canvas is told, in
 * so many words, that this server can't update itself — which is the truth for
 * an embedder that started the server directly.
 *
 * Only one upgrade runs at a time: the request replaces the running binary's
 * files, and two package-manager installs racing over the same directory is
 * how an installation ends up half-written.
 */
export function createUpdatesRouter(updates?: CanvasUpdates): Hono {
  const app = new Hono();
  let inFlight: Promise<unknown> | null = null;

  app.get("/status", async (c) => {
    if (!updates) return c.json(UPDATES_UNAVAILABLE);
    const refresh = c.req.query("refresh") === "1";
    return c.json(await updates.status({ refresh }));
  });

  app.post("/", async (c) => {
    if (!updates) {
      return c.json({ error: { kind: "unavailable", message: UPDATES_UNAVAILABLE.reason } }, 503);
    }
    if (inFlight) {
      return c.json({ error: { kind: "busy", message: "An upgrade is already running." } }, 409);
    }
    const run = updates.upgrade();
    inFlight = run;
    try {
      return c.json(await run);
    } catch (error) {
      return c.json(
        {
          error: {
            kind: "upgrade_failed",
            message: error instanceof Error ? error.message : String(error),
          },
        },
        500,
      );
    } finally {
      inFlight = null;
    }
  });

  return app;
}
