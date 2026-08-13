import { Hono } from "hono";
import { addNote, type MutationContext, removeNote, updateNote } from "../mutations/index.ts";
import { AddNoteBody, RemoveNoteBody, UpdateNoteBody } from "./mutate-schemas.ts";
import { makeRoute } from "./route.ts";

/**
 * Canvas-facing CRUD for free-positioned board notes. Notes are designer-only —
 * never exposed via MCP.
 */
export function createNotesRouter(ctxFor: () => MutationContext): Hono {
  const r = new Hono();
  const route = makeRoute(ctxFor);

  r.get("/", (c) => {
    return c.json({ notes: ctxFor().folder.notes });
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
