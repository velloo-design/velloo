import {
  AgentApprovalBodySchema,
  AgentPromptBodySchema,
  AgentRenameBodySchema,
  AgentStartBodySchema,
} from "@velloo/protocol/agent";
import { type Context, Hono } from "hono";
import type { z } from "zod";
import { AgentError } from "../agent/adapter.ts";
import type { AgentSessionManager } from "../agent/sessions.ts";

const STATUS = {
  "not-found": 404,
  unavailable: 409,
  conflict: 409,
  invalid: 400,
  limit: 429,
} as const;

/**
 * The Agent tab's API. Bodies are strict: a field the contract doesn't name —
 * a working directory, an executable, an environment, a sandbox — is refused,
 * not ignored, so nothing on a page can widen what a local agent may touch.
 */
export function createAgentRouter(agents: AgentSessionManager | undefined): Hono {
  const r = new Hono();

  const respond = async <T>(c: Context, op: (agents: AgentSessionManager) => Promise<T> | T) => {
    if (!agents) {
      return c.json(
        { error: { kind: "BadRequest", code: "unavailable", message: "Agents are not enabled." } },
        404,
      );
    }
    try {
      return c.json((await op(agents)) ?? { ok: true });
    } catch (error) {
      if (error instanceof AgentError) {
        // `BadRequest` is the kind every client already shows as its sentence;
        // `code` is what the Agent tab branches on.
        return c.json(
          { error: { kind: "BadRequest", code: error.code, message: error.message } },
          STATUS[error.code],
        );
      }
      throw error;
    }
  };

  const body = async <S extends z.ZodType>(c: Context, schema: S) => {
    const parsed = schema.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success)
      throw new AgentError("invalid", parsed.error.issues[0]?.message ?? "Invalid body.");
    return parsed.data as z.infer<S>;
  };

  r.get("/providers", (c) =>
    respond(c, async (a) => ({ providers: await a.providers(c.req.query("refresh") === "1") })),
  );
  r.get("/history", (c) =>
    respond(c, async (a) => ({ sessions: await a.history(c.req.query("provider") ?? "") })),
  );
  r.get("/sessions", (c) => respond(c, (a) => ({ sessions: a.list() })));
  r.post("/sessions", (c) =>
    respond(c, async (a) => ({ session: await a.start(await body(c, AgentStartBodySchema)) })),
  );
  r.get("/sessions/:id", (c) => respond(c, (a) => a.snapshot(c.req.param("id"))));
  r.patch("/sessions/:id", (c) =>
    respond(c, async (a) => ({
      session: await a.rename(c.req.param("id"), (await body(c, AgentRenameBodySchema)).title),
    })),
  );
  r.delete("/sessions/:id", (c) => respond(c, (a) => a.remove(c.req.param("id"))));
  r.post("/sessions/:id/reopen", (c) =>
    respond(c, async (a) => ({ session: await a.reopen(c.req.param("id")) })),
  );
  r.post("/sessions/:id/stop", (c) => respond(c, (a) => a.terminate(c.req.param("id"))));
  r.post("/sessions/:id/turns", (c) =>
    respond(c, async (a) => a.prompt(c.req.param("id"), await body(c, AgentPromptBodySchema))),
  );
  r.delete("/sessions/:id/queue/:queuedId", (c) =>
    respond(c, (a) => a.dequeue(c.req.param("id"), c.req.param("queuedId"))),
  );
  r.post("/sessions/:id/interrupt", (c) => respond(c, (a) => a.interrupt(c.req.param("id"))));
  r.post("/sessions/:id/approvals/:approvalId", (c) =>
    respond(c, async (a) =>
      a.answer(
        c.req.param("id"),
        c.req.param("approvalId"),
        (await body(c, AgentApprovalBodySchema)).decision,
      ),
    ),
  );

  return r;
}
