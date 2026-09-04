import { Hono } from "hono";
import {
  addAnnotation,
  addNote,
  type MutationContext,
  removeAnnotation,
  removeNote,
  updateAnnotation,
  updateNote,
} from "../mutations/index.ts";
import { resolveLocator } from "../path.ts";
import {
  AddAnnotationBody,
  AddNoteBody,
  RemoveAnnotationBody,
  RemoveNoteBody,
  UpdateAnnotationBody,
  UpdateNoteBody,
} from "./mutate-schemas.ts";
import { makeRoute } from "./route.ts";

/**
 * The canvas markup layer: node-anchored annotations + free-positioned board
 * notes.
 *
 * Canvas-facing CRUD for annotations. Annotations live in per-screen sidecar
 * files (`screens/<id>.annotations.json`).
 */
export function createAnnotationsRouter(ctxFor: () => MutationContext): Hono {
  const r = new Hono();
  const route = makeRoute(ctxFor);

  // GET /api/annotations/:screenId — list annotations for a screen with their
  // resolved paths (null when the target can't be resolved on the screen tree).
  r.get("/:screenId", (c) => {
    const ctx = ctxFor();
    const screenId = c.req.param("screenId");
    const screen = ctx.folder.screens.get(screenId);
    const annotations = ctx.folder.annotations.get(screenId) ?? [];
    const list = annotations.map((a) => {
      const resolved = screen ? resolveLocator(screen.tree, a.target.locator) : null;
      return { ...a, resolved };
    });
    return c.json({ annotations: list });
  });

  r.post(
    "/add",
    route(AddAnnotationBody, (a, ctx) => addAnnotation(ctx, a)),
  );
  r.post(
    "/update",
    route(UpdateAnnotationBody, (a, ctx) => updateAnnotation(ctx, a)),
  );
  r.post(
    "/remove",
    route(RemoveAnnotationBody, (a, ctx) => removeAnnotation(ctx, a)),
  );

  return r;
}

/**
 * Canvas-facing CRUD for per-board notes, free-positioned or attached to a
 * node inside a frame.
 *
 * Also exposed to agents via the MCP note tools (add_note / list_notes /
 * update_note / remove_note). Each board has its own notes file at
 * `boards/<id>.notes.json`.
 */
export function createNotesRouter(ctxFor: () => MutationContext): Hono {
  const r = new Hono();
  const route = makeRoute(ctxFor);

  // GET /api/notes/:boardId — list notes for a specific board. Attached notes
  // carry their resolved node path (null when the target is gone), so the
  // canvas can anchor them without re-walking the screen tree.
  r.get("/:boardId", (c) => {
    const ctx = ctxFor();
    const boardId = c.req.param("boardId");
    const notes = ctx.folder.notes.get(boardId) ?? [];
    const list = notes.map((note) => {
      if (!note.attachment) return note;
      const screen = ctx.folder.screens.get(note.attachment.screenId);
      const resolved = screen ? resolveLocator(screen.tree, note.attachment.locator) : null;
      return { ...note, resolved };
    });
    return c.json({ notes: list });
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
