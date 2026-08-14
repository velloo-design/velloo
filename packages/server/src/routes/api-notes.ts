import { Hono } from "hono";
import { addNote, type MutationContext, removeNote, updateNote } from "../mutations/index.ts";
import { AddNoteBody, RemoveNoteBody, UpdateNoteBody } from "./mutate-schemas.ts";
import { makeRoute } from "./route.ts";

/**
 * Canvas-facing CRUD for free-positioned per-board notes.
 *
 * Notes are designer-only — never exposed via MCP. Each board has its own
 * notes file at `boards/<id>.notes.json`.
 */
export function createNotesRouter(ctxFor: () => MutationContext): Hono {
  const r = new Hono();
  const route = makeRoute(ctxFor);

  // GET /api/notes/:boardId — list notes for a specific board.
  r.get("/:boardId", (c) => {
    const boardId = c.req.param("boardId");
    const notes = ctxFor().folder.notes.get(boardId) ?? [];
    return c.json({ notes });
  });

  r.post(
    "/add",
    route(AddNoteBody, (a, ctx) => addNote(ctx, a)),
  );
  r.post(
    "/update",
    route(UpdateNoteBody, (a, ctx) => updateNote(ctx, a)),
  );
  r.post(
    "/remove",
    route(RemoveNoteBody, (a, ctx) => removeNote(ctx, a)),
  );

  return r;
}
