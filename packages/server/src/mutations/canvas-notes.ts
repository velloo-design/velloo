import { randomUUID } from "node:crypto";
import { $, DoAsync, err, type Result } from "@velloo/result";
import type { CanvasNote } from "@velloo/schema";
import type { MutationContext } from "./context.ts";
import { canvasNoteNotFound, type MutationError } from "./errors.ts";
import { persistCanvasNotes } from "./persist.ts";

function newNoteId(): string {
  return `note_${randomUUID().replace(/-/g, "").slice(0, 8)}`;
}

const DEFAULT_NOTE_WIDTH = 240;

export interface AddNoteArgs {
  x: number;
  y: number;
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
    const note: CanvasNote = {
      id: newNoteId(),
      x: args.x,
      y: args.y,
      width: args.width ?? DEFAULT_NOTE_WIDTH,
      body: args.body,
    };
    await persistCanvasNotes(ctx.folder, [...ctx.folder.notes, note]);
    ctx.broadcast({ type: "notes-changed" });
    return { note };
  });
}

export interface UpdateNoteArgs {
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
    const idx = ctx.folder.notes.findIndex((n) => n.id === args.noteId);
    if (idx === -1) return yield* $(err(canvasNoteNotFound(args.noteId)));
    const prev = ctx.folder.notes[idx] as CanvasNote;
    const next: CanvasNote = {
      ...prev,
      ...(args.patch.x !== undefined ? { x: args.patch.x } : {}),
      ...(args.patch.y !== undefined ? { y: args.patch.y } : {}),
      ...(args.patch.width !== undefined ? { width: args.patch.width } : {}),
      ...(args.patch.body !== undefined ? { body: args.patch.body } : {}),
    };
    const updated = [...ctx.folder.notes];
    updated[idx] = next;
    await persistCanvasNotes(ctx.folder, updated);
    ctx.broadcast({ type: "notes-changed" });
    return { note: next };
  });
}

export interface RemoveNoteArgs {
  noteId: string;
}

export async function removeNote(
  ctx: MutationContext,
  args: RemoveNoteArgs,
): Promise<Result<{ removedId: string }, MutationError>> {
  return DoAsync<{ removedId: string }, MutationError>(async function* () {
    if (!ctx.folder.notes.some((n) => n.id === args.noteId)) {
      return yield* $(err(canvasNoteNotFound(args.noteId)));
    }
    const next = ctx.folder.notes.filter((n) => n.id !== args.noteId);
    await persistCanvasNotes(ctx.folder, next);
    ctx.broadcast({ type: "notes-changed" });
    return { removedId: args.noteId };
  });
}
