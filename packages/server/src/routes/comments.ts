import { CommentAnchorSchema, CommentAuthorSchema } from "@velloo/schema";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { CommentStoreError, type LocalCommentsService } from "../local-comments.ts";

const CreateBody = z.object({
  boardId: z.string().min(1),
  body: z.string().min(1).max(4000),
  anchor: CommentAnchorSchema.optional(),
  author: CommentAuthorSchema.optional(),
  scope: z.enum(["local", "shared"]).optional(),
});

const ReplyBody = z.object({
  body: z.string().min(1).max(4000),
  author: CommentAuthorSchema.optional(),
});

const UpdateBody = z
  .object({ resolved: z.boolean().optional(), scope: z.literal("shared").optional() })
  .refine((value) => value.resolved !== undefined || value.scope !== undefined);

export function createCommentsRouter(service: LocalCommentsService): Hono {
  const r = new Hono();

  const respond = async <T>(c: Context, op: () => Promise<T>) => {
    try {
      return c.json(await op());
    } catch (error) {
      if (error instanceof CommentStoreError) {
        return c.json(
          { error: { code: error.code, message: error.message } },
          error.code === "not-found" ? 404 : 400,
        );
      }
      if (error instanceof z.ZodError) {
        return c.json({ error: { code: "invalid", message: error.message } }, 400);
      }
      throw error;
    }
  };

  r.get("/", (c) => {
    const boardId = c.req.query("boardId") ?? "";
    const statusParam = c.req.query("status") ?? "open";
    const status = statusParam === "resolved" || statusParam === "all" ? statusParam : "open";
    const scopeParam = c.req.query("scope") ?? "all";
    const scope = scopeParam === "local" || scopeParam === "shared" ? scopeParam : "all";
    return respond(c, async () => ({ threads: await service.list(boardId, status, scope) }));
  });

  // Registered ahead of `/:id` so the literal wins the match.
  r.get("/cloud", (c) => respond(c, () => service.cloudAvailability(c.req.query("boardId") ?? "")));

  r.get("/:id", (c) => respond(c, async () => ({ thread: await service.get(c.req.param("id")) })));

  r.post("/", async (c) => {
    const parsed = CreateBody.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) {
      return c.json({ error: { code: "invalid", message: parsed.error.message } }, 400);
    }
    return respond(c, async () => ({ thread: await service.create(parsed.data) }));
  });

  r.post("/:id/messages", async (c) => {
    const parsed = ReplyBody.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) {
      return c.json({ error: { code: "invalid", message: parsed.error.message } }, 400);
    }
    return respond(c, async () => ({
      thread: await service.reply(c.req.param("id"), parsed.data),
    }));
  });

  r.patch("/:id", async (c) => {
    const parsed = UpdateBody.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) {
      return c.json({ error: { code: "invalid", message: parsed.error.message } }, 400);
    }
    return respond(c, async () => {
      let thread = await service.get(c.req.param("id"));
      if (parsed.data.resolved !== undefined) {
        thread = await service.setResolved(thread.id, parsed.data.resolved);
      }
      if (parsed.data.scope === "shared" && thread.scope === "local") {
        thread = await service.promoteToShared(thread.id);
      }
      return { thread };
    });
  });

  r.delete("/:id", (c) => respond(c, () => service.delete(c.req.param("id"))));

  return r;
}
