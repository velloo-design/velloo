import { randomUUID } from "node:crypto";
import { $, DoAsync, err, ok, type Result } from "@velloo/result";
import type { Board, CanvasNote, CanvasNoteAttachment } from "@velloo/schema";
import type { MutationContext } from "./context.ts";
import { canvasNoteNotFound, frameNotFound, invalidPath, type MutationError } from "./errors.ts";
import { getBoard, getScreen, resolve } from "./lookup.ts";
import { persistCanvasNotes } from "./persist.ts";

function newNoteId(): string {
  return `note_${randomUUID().replace(/-/g, "").slice(0, 8)}`;
}

const DEFAULT_NOTE_WIDTH = 240;

/**
 * An attachment names a frame on this board, the screen that frame shows,
 * and a node in it. Validating all three at write time keeps a stale
 * anchor out of the file — a node that disappears *later* is handled at
 * read time, where the note renders as stale rather than vanishing.
 */
function checkAttachment(
  ctx: MutationContext,
  board: Board,
  attachment: CanvasNoteAttachment,
): Result<void, MutationError> {
  const frame = board.frames.find((f) => f.id === attachment.frameId);
  if (!frame) return err(frameNotFound(board.id, attachment.frameId));
  if (frame.screen !== attachment.screenId) {
    return err(
      invalidPath(
        `Frame "${attachment.frameId}" shows screen "${frame.screen}", not "${attachment.screenId}"`,
      ),
    );
  }
  const screen = getScreen(ctx, attachment.screenId);
  if (!screen.ok) return screen;
  const resolved = resolve(screen.value.tree, attachment.locator, attachment.screenId);
  return resolved.ok ? ok(undefined) : resolved;
}

export interface AddNoteArgs {
  boardId: string;
  x?: number | undefined;
  y?: number | undefined;
  width?: number | undefined;
  body: string;
  attachment?: CanvasNoteAttachment | undefined;
}

export interface NoteResult {
  note: CanvasNote;
}

export async function addNote(
  ctx: MutationContext,
  args: AddNoteArgs,
): Promise<Result<NoteResult, MutationError>> {
  return DoAsync<NoteResult, MutationError>(async function* () {
    const board = yield* $(getBoard(ctx, args.boardId));
    if (args.attachment) {
      yield* $(checkAttachment(ctx, board, args.attachment));
    } else if (args.x === undefined || args.y === undefined) {
      return yield* $(err(invalidPath("A note without an attachment needs x and y")));
    }
    const note: CanvasNote = {
      id: newNoteId(),
      ...(args.x !== undefined ? { x: args.x } : {}),
      ...(args.y !== undefined ? { y: args.y } : {}),
      width: args.width ?? DEFAULT_NOTE_WIDTH,
      body: args.body,
      ...(args.attachment ? { attachment: args.attachment } : {}),
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
