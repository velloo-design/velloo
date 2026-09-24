import { type Context, Hono } from "hono";
import { asSignInRequired } from "../cloud.ts";
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

  const noPublisher = "this server cannot publish — run the canvas through the velloo CLI";
  const unavailable = { error: noPublisher };

  app.get("/status", (c) => {
    if (!runner) return c.json({ state: "unavailable" as const });
    return c.json(runner.state());
  });

  /**
   * What the publish dialog needs to fill itself in: whether the account can
   * publish at all, the teams it may publish into, and the links it could
   * update.
   *
   * `access` is the load-bearing field. It used to be a bare `ready` boolean
   * meaning "a credential file entry exists", which let a revoked token walk
   * straight past the dialog's sign-in branch and fail on the first cloud call
   * instead — so the dialog offered no way out of the one state it could fix.
   */
  app.get("/targets", async (c) => {
    const closed = (access: "signed-out" | "expired") =>
      c.json({ ready: false, access, teams: [], slots: [] });
    if (!runner) return closed("signed-out");
    const access = await runner.access();
    // Teams need a live cloud call, so an unusable account offers none rather
    // than failing the whole dialog.
    if (access.state !== "ready") return closed(access.state);
    const [teams, blocked, destinationResult] = await Promise.all([
      runner.teams().catch(() => []),
      runner.blocked().catch(() => null),
      runner
        .destinations()
        .then((value) => ({ value }))
        .catch((error: unknown) => ({
          error: error instanceof Error ? error.message : String(error),
          // A credential can be revoked between `access()` and this call — the
          // verdict behind `access` is cached for a minute. Classify it here so
          // a race still lands the user on a sign-in rather than on red text.
          signInRequired: asSignInRequired(error),
        })),
    ]);
    if ("error" in destinationResult) {
      if (destinationResult.signInRequired) return closed(destinationResult.signInRequired);
      return c.json({
        ready: true,
        access: "ready",
        teams,
        ...(blocked ? { blocked } : {}),
        slots: [],
        destinationError: destinationResult.error,
      });
    }
    return c.json({
      ready: true,
      access: "ready",
      teams,
      ...(blocked ? { blocked } : {}),
      ...destinationResult.value,
    });
  });

  app.post("/", async (c) => {
    if (!runner) return c.json(unavailable, 503);
    const body = (await c.req.json().catch(() => ({}))) as {
      boardIds?: unknown;
      title?: unknown;
      visibility?: unknown;
      password?: unknown;
      teamId?: unknown;
      publicComments?: unknown;
      destination?: unknown;
    };
    const boardIds = Array.isArray(body.boardIds)
      ? body.boardIds.filter((id): id is string => typeof id === "string")
      : [];
    const visibility = body.visibility === "private" ? "private" : "public";
    const title = typeof body.title === "string" ? body.title : undefined;
    const teamId = typeof body.teamId === "string" && body.teamId ? body.teamId : undefined;
    const publicComments =
      typeof body.publicComments === "boolean" ? body.publicComments : undefined;
    // Passed straight through to the cloud, which hashes it. It is never
    // written to the folder, the run state, or a log line on the way.
    if (typeof body.password === "string" && body.password.length < 3) {
      return c.json({ error: "password must be at least 3 characters" }, 400);
    }
    const password = typeof body.password === "string" ? body.password : undefined;
    const rawDestination = body.destination as Record<string, unknown> | null | undefined;
    const destination =
      rawDestination?.mode === "new"
        ? ({ mode: "new" } as const)
        : rawDestination?.mode === "update" &&
            typeof rawDestination.slug === "string" &&
            (typeof rawDestination.expectedVersionId === "string" ||
              rawDestination.expectedVersionId === null)
          ? ({
              mode: "update" as const,
              slug: rawDestination.slug,
              expectedVersionId: rawDestination.expectedVersionId,
            } as const)
          : null;
    if (!destination) return c.json({ error: "choose a publish destination" }, 400);
    const started = runner.start({
      boardIds,
      visibility,
      destination,
      ...(title ? { title } : {}),
      ...(password ? { password } : {}),
      ...(teamId ? { teamId } : {}),
      ...(publicComments !== undefined ? { publicComments } : {}),
    });
    if (!started) {
      return c.json({ error: "a publish is already running for this folder" }, 409);
    }
    return c.json(started, 202);
  });

  /**
   * The account's published links, and taking one down.
   *
   * Registered before `/reset` only for readability — they share no prefix.
   * Both go straight to the cloud rather than through the run state: nothing
   * is rendered, so there is no long job to poll, and the answer must be live
   * (the whole point of the list is deciding which board to free).
   *
   * A rejected credential keeps its identity through `LoggedOut`, which is the
   * one kind the canvas acts on instead of printing.
   */
  const cloudFail = (c: Context, error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    const kind = asSignInRequired(error) ? "LoggedOut" : "HttpFailure";
    return c.json({ error: { kind, message } }, 502);
  };

  const noPublisherFail = (c: Context) =>
    c.json({ error: { kind: "HttpFailure", message: noPublisher } }, 503);

  app.get("/published", async (c) => {
    if (!runner) return noPublisherFail(c);
    try {
      return c.json({ boards: await runner.published() });
    } catch (error) {
      return cloudFail(c, error);
    }
  });

  app.delete("/published/:slug", async (c) => {
    if (!runner) return noPublisherFail(c);
    try {
      await runner.unpublish(c.req.param("slug"));
      return c.json({ ok: true });
    } catch (error) {
      return cloudFail(c, error);
    }
  });

  /** Drop a finished run so the dialog reopens clean. */
  app.post("/reset", (c) => {
    runner?.reset();
    return c.json({ ok: true });
  });

  return app;
}
