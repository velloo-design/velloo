import { randomUUID } from "node:crypto";
import { $, DoAsync, err, type Result } from "@velloo/result";
import type { CanvasNote } from "@velloo/schema";
import type { MutationContext } from "./context.ts";
import { canvasNoteNotFound, type MutationError } from "./errors.ts";
import { getBoard } from "./lookup.ts";
import { persistCanvasNotes } from "./persist.ts";

function newNoteId(): string {
  return `note_${randomUUID().replace(/-/g, "").slice(0, 8)}`;
}

const DEFAULT_NOTE_WIDTH = 240;

export interface AddNoteArgs {
  boardId: string;
  x: number;
  y: number;
  width?: number | undefined;
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
    yield* $(getBoard(ctx, args.boardId));
    const note: CanvasNote = {
      id: newNoteId(),
      x: args.x,
      y: args.y,
      width: args.width ?? DEFAULT_NOTE_WIDTH,
      body: args.body,
    };
    const existing = ctx.folder.notes.get(args.boardId) ?? [];
    await persistCanvasNotes(ctx.folder, args.boardId, [...existing, note]);
    ctx.broadcast({ type: "notes-changed", boardId: args.boardId });
    return { note };
  });
}

export interface UpdateNoteArgs {
  boardId: string;
  noteId: string;
  patch: {
    x?: number | undefined;
    y?: number | undefined;
    width?: number | undefined;
    body?: string | undefined;
  };
}

export async function updateNote(
  ctx: MutationContext,
  args: UpdateNoteArgs,
): Promise<Result<NoteResult, MutationError>> {
  return DoAsync<NoteResult, MutationError>(async function* () {
    const existing = ctx.folder.notes.get(args.boardId) ?? [];
    const idx = existing.findIndex((n) => n.id === args.noteId);
    if (idx === -1) return yield* $(err(canvasNoteNotFound(args.noteId)));
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
    await persistCanvasNotes(ctx.folder, args.boardId, updated);
    ctx.broadcast({ type: "notes-changed", boardId: args.boardId });
    return { note: next };
  });
}

export interface RemoveNoteArgs {
  boardId: string;
  noteId: string;
}

export async function removeNote(
  ctx: MutationContext,
  args: RemoveNoteArgs,
): Promise<Result<{ removedId: string }, MutationError>> {
  return DoAsync<{ removedId: string }, MutationError>(async function* () {
    const existing = ctx.folder.notes.get(args.boardId) ?? [];
    if (!existing.some((n) => n.id === args.noteId)) {
      return yield* $(err(canvasNoteNotFound(args.noteId)));
    }
    const next = existing.filter((n) => n.id !== args.noteId);
    await persistCanvasNotes(ctx.folder, args.boardId, next);
    ctx.broadcast({ type: "notes-changed", boardId: args.boardId });
    return { removedId: args.noteId };
  });
}
