import { Hono } from "hono";
import type { CanvasAuth } from "../cloud.ts";

/**
 * Canvas account menu backing: live login state + logout. The CLI provides the
 * `CanvasAuth` controller (it owns `~/.velloo`); without one, the canvas just
 * reports logged out.
 */
export function createAuthRouter(auth?: CanvasAuth): Hono {
  const app = new Hono();

  app.get("/status", async (c) => {
    if (!auth) return c.json({ loggedIn: false });
    return c.json(await auth.status());
  });

  app.post("/logout", async (c) => {
    if (auth) await auth.logout();
    return c.json({ ok: true });
  });

  return app;
}
