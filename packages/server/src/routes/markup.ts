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
