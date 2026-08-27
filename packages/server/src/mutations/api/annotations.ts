import type { Result } from "@velloo/result";
import {
  type AddAnnotationArgs,
  type AnnotationResult,
  addAnnotation as addAnnotationImpl,
  type RemoveAnnotationArgs,
  removeAnnotation as removeAnnotationImpl,
  type UpdateAnnotationArgs,
  updateAnnotation as updateAnnotationImpl,
} from "../annotations.ts";
import {
  type AddNoteArgs,
  addNote as addNoteImpl,
  type NoteResult,
  type RemoveNoteArgs,
  removeNote as removeNoteImpl,
  type UpdateNoteArgs,
  updateNote as updateNoteImpl,
} from "../canvas-notes.ts";
import type { MutationContext } from "../context.ts";
import { withBoardLock, withScreenLock } from "../context.ts";
import type { MutationError } from "../errors.ts";

export function addAnnotation(
  ctx: MutationContext,
  args: AddAnnotationArgs,
): Promise<Result<AnnotationResult, MutationError>> {
  return withScreenLock(ctx.folder, args.screenId, () => addAnnotationImpl(ctx, args));
}
export function updateAnnotation(
  ctx: MutationContext,
  args: UpdateAnnotationArgs,
): Promise<Result<AnnotationResult, MutationError>> {
  return withScreenLock(ctx.folder, args.screenId, () => updateAnnotationImpl(ctx, args));
}
export function removeAnnotation(
  ctx: MutationContext,
  args: RemoveAnnotationArgs,
): Promise<Result<{ removedId: string }, MutationError>> {
  return withScreenLock(ctx.folder, args.screenId, () => removeAnnotationImpl(ctx, args));
}
export function addNote(
  ctx: MutationContext,
  args: AddNoteArgs,
): Promise<Result<NoteResult, MutationError>> {
  return withBoardLock(ctx.folder, args.boardId, () => addNoteImpl(ctx, args));
}
export function updateNote(
  ctx: MutationContext,
  args: UpdateNoteArgs,
): Promise<Result<NoteResult, MutationError>> {
  return withBoardLock(ctx.folder, args.boardId, () => updateNoteImpl(ctx, args));
}
export function removeNote(
  ctx: MutationContext,
  args: RemoveNoteArgs,
): Promise<Result<{ removedId: string }, MutationError>> {
  return withBoardLock(ctx.folder, args.boardId, () => removeNoteImpl(ctx, args));
}

export type {
  AddAnnotationArgs,
  AddNoteArgs,
  AnnotationResult,
  NoteResult,
  RemoveAnnotationArgs,
  RemoveNoteArgs,
  UpdateAnnotationArgs,
  UpdateNoteArgs,
};
