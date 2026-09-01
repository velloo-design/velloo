import { Hono } from "hono";
import type { PublishRunner } from "../publish-run.ts";

/**
 * Publish-to-cloud for the canvas. The work happens in a CLI-provided
 * publisher (it owns the credential and the cloud transport); these routes only
 * start it and report where it got to — see publish-run.ts for why a publish
 * can't be one request/response.
 *
 * Without a publisher (an embedder with no CLI behind it) every route reports
 * unavailable rather than pretending to publish.
 */
export function createPublishRouter(runner?: PublishRunner): Hono {
  const app = new Hono();

  const unavailable = {
    error: "this server cannot publish — run the canvas through the velloo CLI",
  };

  app.get("/status", (c) => {
    if (!runner) return c.json({ state: "unavailable" as const });
    return c.json(runner.state());
  });

  /** What the publish dialog needs to fill itself in: sign-in state + teams. */
  app.get("/targets", async (c) => {
    if (!runner) return c.json({ ready: false, teams: [] });
    const ready = await runner.ready();
    // Teams need a live cloud call, so a logged-out or offline account offers
    // none rather than failing the whole dialog.
    const teams = ready ? await runner.teams().catch(() => []) : [];
    return c.json({ ready, teams });
  });

  app.post("/", async (c) => {
    if (!runner) return c.json(unavailable, 503);
    const body = (await c.req.json().catch(() => ({}))) as {
      boardIds?: unknown;
      title?: unknown;
      visibility?: unknown;
      password?: unknown;
      teamId?: unknown;
      screenshots?: unknown;
    };
    const boardIds = Array.isArray(body.boardIds)
      ? body.boardIds.filter((id): id is string => typeof id === "string")
      : [];
    const visibility = body.visibility === "private" ? "private" : "public";
    const title = typeof body.title === "string" ? body.title : undefined;
    const teamId = typeof body.teamId === "string" && body.teamId ? body.teamId : undefined;
    // Passed straight through to the cloud, which hashes it. It is never
    // written to the folder, the run state, or a log line on the way.
    const password =
      typeof body.password === "string" && body.password.length >= 8 ? body.password : undefined;
    const started = runner.start({
      boardIds,
      visibility,
      screenshots: body.screenshots !== false,
      ...(title ? { title } : {}),
      ...(password ? { password } : {}),
      ...(teamId ? { teamId } : {}),
    });
    if (!started) {
      return c.json({ error: "a publish is already running for this folder" }, 409);
    }
    return c.json(started, 202);
  });

  /** Drop a finished run so the dialog reopens clean. */
  app.post("/reset", (c) => {
    runner?.reset();
    return c.json({ ok: true });
  });

  return app;
}
