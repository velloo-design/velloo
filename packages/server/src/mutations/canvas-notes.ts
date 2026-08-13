import { randomUUID } from "node:crypto";
import { $, DoAsync, err, type Result } from "@velloo/result";
import type { CanvasNote } from "@velloo/schema";
import type { MutationContext } from "./context.ts";
import { canvasNoteNotFound, type MutationError, pageNotFound } from "./errors.ts";
import { getPage } from "./lookup.ts";
import { persistCanvasNotes } from "./persist.ts";

function newNoteId(): string {
  return `note_${randomUUID().replace(/-/g, "").slice(0, 8)}`;
}

const DEFAULT_NOTE_WIDTH = 240;

export interface AddNoteArgs {
  pageId: string;
  x: number;
  y: number;
  /** Defaults to 240 (small comfortable size for ~1-2 lines of markdown). */
  width?: number;
  body: string;
}

export interface NoteResult {
  note: CanvasNote;
}

export async function addNote(
  ctx: MutationContext,
  args: AddNoteArgs,
): Promise<Result<NoteResult, MutationError>> {
  return DoAsync<NoteResult, MutationError>(async function* () {
    yield* $(getPage(ctx, args.pageId));
    const note: CanvasNote = {
      id: newNoteId(),
      x: args.x,
      y: args.y,
      width: args.width ?? DEFAULT_NOTE_WIDTH,
      body: args.body,
    };
    const existing = ctx.folder.notes.get(args.pageId) ?? [];
    await persistCanvasNotes(ctx.folder, args.pageId, [...existing, note]);
    ctx.broadcast({ type: "notes-changed", pageId: args.pageId });
    return { note };
  });
}

export interface UpdateNoteArgs {
  pageId: string;
  noteId: string;
  patch: {
    x?: number;
    y?: number;
    width?: number;
    body?: string;
  };
}

export async function updateNote(
  ctx: MutationContext,
  args: UpdateNoteArgs,
): Promise<Result<NoteResult, MutationError>> {
  return DoAsync<NoteResult, MutationError>(async function* () {
    const existing = ctx.folder.notes.get(args.pageId);
    if (!existing) return yield* $(err(pageNotFound(args.pageId)));
    const idx = existing.findIndex((n) => n.id === args.noteId);
    if (idx === -1) return yield* $(err(canvasNoteNotFound(args.pageId, args.noteId)));
    const prev = existing[idx] as CanvasNote;
    const next: CanvasNote = {
      ...prev,
      ...(args.patch.x !== undefined ? { x: args.patch.x } : {}),
      ...(args.patch.y !== undefined ? { y: args.patch.y } : {}),
      ...(args.patch.width !== undefined ? { width: args.patch.width } : {}),
      ...(args.patch.body !== undefined ? { body: args.patch.body } : {}),
    };
    const updated = [...existing];
    updated[idx] = next;
    await persistCanvasNotes(ctx.folder, args.pageId, updated);
    ctx.broadcast({ type: "notes-changed", pageId: args.pageId });
    return { note: next };
  });
}

export interface RemoveNoteArgs {
  pageId: string;
  noteId: string;
}

export async function removeNote(
  ctx: MutationContext,
  args: RemoveNoteArgs,
): Promise<Result<{ removedId: string }, MutationError>> {
  return DoAsync<{ removedId: string }, MutationError>(async function* () {
    const existing = ctx.folder.notes.get(args.pageId);
    if (!existing) return yield* $(err(pageNotFound(args.pageId)));
    if (!existing.some((n) => n.id === args.noteId)) {
      return yield* $(err(canvasNoteNotFound(args.pageId, args.noteId)));
    }
    const next = existing.filter((n) => n.id !== args.noteId);
    await persistCanvasNotes(ctx.folder, args.pageId, next);
    ctx.broadcast({ type: "notes-changed", pageId: args.pageId });
    return { removedId: args.noteId };
  });
}
