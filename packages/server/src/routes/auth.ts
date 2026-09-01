import { Hono } from "hono";
import { type CanvasAuth, LOGGED_OUT } from "../cloud.ts";

/**
 * Canvas account menu backing: live login state, in-canvas sign-in, and
 * logout. The CLI provides the `CanvasAuth` controller (it owns `~/.velloo`);
 * without one the canvas reports logged out and the sign-in routes refuse,
 * since nothing here can reach a credential store on its own.
 *
 * Sign-in is two-phase because the OAuth device flow is: POST /login returns
 * the code to type, then the canvas polls /status until `login` leaves
 * `pending` — success flips `loggedIn`, failure leaves the reason in `login`.
 */
export function createAuthRouter(auth?: CanvasAuth): Hono {
  const app = new Hono();

  app.get("/status", async (c) => {
    if (!auth) return c.json(LOGGED_OUT);
    return c.json(await auth.status());
  });

  app.post("/login", async (c) => {
    if (!auth) return c.json({ error: "this server has no credential store to sign in to" }, 503);
    return c.json(await auth.beginLogin());
  });

  app.post("/login/cancel", async (c) => {
    if (auth) await auth.cancelLogin();
    return c.json({ ok: true });
  });

  app.post("/logout", async (c) => {
    if (auth) await auth.logout();
    return c.json({ ok: true });
  });

  return app;
}
