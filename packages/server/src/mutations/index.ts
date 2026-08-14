import type { Result } from "@velloo/result";
import { type AddNodeArgs, type AddNodeResult, addNode as addNodeImpl } from "./add-node.ts";
import { type AddFrameArgs, type AddFrameResult, addFrame as addFrameImpl } from "./add-frame.ts";
import {
  type AddScreenArgs,
  type AddScreenResult,
  addScreen as addScreenImpl,
} from "./add-screen.ts";
import {
  type AddSnippetArgs,
  type AddSnippetResult,
  addSnippet as addSnippetImpl,
} from "./add-snippet.ts";
import {
  type AddAnnotationArgs,
  type AnnotationResult,
  addAnnotation as addAnnotationImpl,
  type RemoveAnnotationArgs,
  removeAnnotation as removeAnnotationImpl,
  type UpdateAnnotationArgs,
  updateAnnotation as updateAnnotationImpl,
} from "./annotations.ts";
import { type ApplyClassesArgs, applyClasses as applyClassesImpl } from "./apply-classes.ts";
import {
  type ApplyClassesBulkArgs,
  applyClassesBulk as applyClassesBulkImpl,
} from "./apply-classes-bulk.ts";
import {
  type AddBoardArgs,
  type AddBoardResult,
  addBoard as addBoardImpl,
  type RemoveBoardArgs,
  type RemoveBoardResult,
  removeBoard as removeBoardImpl,
  type UpdateBoardArgs,
  type UpdateBoardResult,
  updateBoard as updateBoardImpl,
} from "./boards.ts";
import {
  type AddNoteArgs,
  addNote as addNoteImpl,
  type NoteResult,
  type RemoveNoteArgs,
  removeNote as removeNoteImpl,
  type UpdateNoteArgs,
  updateNote as updateNoteImpl,
} from "./canvas-notes.ts";
import type { MutationContext } from "./context.ts";
import { withBoardLock, withScreenLock, withSnippetLock } from "./context.ts";
import {
  type AuditSnippetArgs,
  auditSnippet as auditSnippetImpl,
  type DarkModeAuditArgs,
  type DarkModeAuditResult,
  darkModeAudit as darkModeAuditImpl,
} from "./dark-mode-audit.ts";
import type { MutationError } from "./errors.ts";
import {
  type AddGroupArgs,
  type AddGroupResult,
  addGroup as addGroupImpl,
  type RemoveGroupArgs,
  type RemoveGroupResult,
  removeGroup as removeGroupImpl,
  type UpdateGroupArgs,
  type UpdateGroupResult,
  updateGroup as updateGroupImpl,
} from "./groups.ts";
import { type InspectArgs, type InspectResult, inspect as inspectImpl } from "./inspect.ts";
import {
  type InstantiateSnippetArgs,
  type InstantiateSnippetResult,
  instantiateSnippet as instantiateSnippetImpl,
} from "./instantiate-snippet.ts";
import { type MoveNodeArgs, type MoveNodeResult, moveNode as moveNodeImpl } from "./move-node.ts";
import {
  type RemoveFrameArgs,
  type RemoveFrameResult,
  removeFrame as removeFrameImpl,
} from "./remove-frame.ts";
import {
  type RemoveNodeArgs,
  type RemoveNodeResult,
  removeNode as removeNodeImpl,
} from "./remove-node.ts";
import {
  type RemoveScreenArgs,
  type RemoveScreenResult,
  removeScreen as removeScreenImpl,
  removeScreenStrict as removeScreenStrictImpl,
} from "./remove-screen.ts";
import {
  type RemoveSnippetArgs,
  type RemoveSnippetResult,
  removeSnippet as removeSnippetImpl,
} from "./remove-snippet.ts";
import {
  type SetNodeIdArgs,
  type SetNodeIdResult,
  setNodeId as setNodeIdImpl,
} from "./set-node-id.ts";
import {
  type UpdateFrameArgs,
  type UpdateFrameResult,
  updateFrame as updateFrameImpl,
  type UpdateFramesArgs,
  type UpdateFramesResult,
  updateFrames as updateFramesImpl,
} from "./update-frame.ts";
import {
  type UpdatePropsArgs,
  type UpdatePropsResult,
  updateProps as updatePropsImpl,
} from "./update-props.ts";
import {
  type UpdatePropsBulkArgs,
  type UpdatePropsBulkResult,
  updatePropsBulk as updatePropsBulkImpl,
} from "./update-props-bulk.ts";
import {
  type UpdateScreenArgs,
  type UpdateScreenResult,
  updateScreen as updateScreenImpl,
} from "./update-screen.ts";
import {
  type UpdateSnippetArgs,
  type UpdateSnippetResult,
  updateSnippet as updateSnippetImpl,
} from "./update-snippet.ts";
import {
  type UpdateSnippetArgsArgs,
  type UpdateSnippetArgsResult,
  updateSnippetArgs as updateSnippetArgsImpl,
} from "./update-snippet-args.ts";

// ── Tree mutations ─────────────────────────────────────────────
export function addNode(
  ctx: MutationContext,
  args: AddNodeArgs,
): Promise<Result<AddNodeResult, MutationError>> {
  return withScreenLock(args.screenId, () => addNodeImpl(ctx, args));
}
export function updateProps(
  ctx: MutationContext,
  args: UpdatePropsArgs,
): Promise<Result<UpdatePropsResult, MutationError>> {
  return withScreenLock(args.screenId, () => updatePropsImpl(ctx, args));
}
export function moveNode(
  ctx: MutationContext,
  args: MoveNodeArgs,
): Promise<Result<MoveNodeResult, MutationError>> {
  return withScreenLock(args.screenId, () => moveNodeImpl(ctx, args));
}
export function removeNode(
  ctx: MutationContext,
  args: RemoveNodeArgs,
): Promise<Result<RemoveNodeResult, MutationError>> {
  return withScreenLock(args.screenId, () => removeNodeImpl(ctx, args));
}
export function applyClasses(
  ctx: MutationContext,
  args: ApplyClassesArgs,
): Promise<Result<UpdatePropsResult, MutationError>> {
  return withScreenLock(args.screenId, () => applyClassesImpl(ctx, args));
}
export function applyClassesBulk(
  ctx: MutationContext,
  args: ApplyClassesBulkArgs,
): Promise<Result<UpdatePropsBulkResult, MutationError>> {
  return withScreenLock(args.screenId, () => applyClassesBulkImpl(ctx, args));
}
export function updatePropsBulk(
  ctx: MutationContext,
  args: UpdatePropsBulkArgs,
): Promise<Result<UpdatePropsBulkResult, MutationError>> {
  return withScreenLock(args.screenId, () => updatePropsBulkImpl(ctx, args));
}
export function setNodeId(
  ctx: MutationContext,
  args: SetNodeIdArgs,
): Promise<Result<SetNodeIdResult, MutationError>> {
  return withScreenLock(args.screenId, () => setNodeIdImpl(ctx, args));
}

// ── Screen lifecycle ───────────────────────────────────────────
export function addScreen(
  ctx: MutationContext,
  args: AddScreenArgs,
): Promise<Result<AddScreenResult, MutationError>> {
  return addScreenImpl(ctx, args);
}
export function removeScreen(
  ctx: MutationContext,
  args: RemoveScreenArgs,
): Promise<Result<RemoveScreenResult, MutationError>> {
  return withScreenLock(args.screenId, () => removeScreenImpl(ctx, args));
}
export function removeScreenStrict(
  ctx: MutationContext,
  args: RemoveScreenArgs,
): Promise<Result<RemoveScreenResult, MutationError>> {
  return withScreenLock(args.screenId, () => removeScreenStrictImpl(ctx, args));
}
export function updateScreen(
  ctx: MutationContext,
  args: UpdateScreenArgs,
): Promise<Result<UpdateScreenResult, MutationError>> {
  return withScreenLock(args.screenId, () => updateScreenImpl(ctx, args));
}

// ── Board lifecycle ────────────────────────────────────────────
export function addBoard(
  ctx: MutationContext,
  args: AddBoardArgs,
): Promise<Result<AddBoardResult, MutationError>> {
  return addBoardImpl(ctx, args);
}
export function updateBoard(
  ctx: MutationContext,
  args: UpdateBoardArgs,
): Promise<Result<UpdateBoardResult, MutationError>> {
  return withBoardLock(args.boardId, () => updateBoardImpl(ctx, args));
}
export function removeBoard(
  ctx: MutationContext,
  args: RemoveBoardArgs,
): Promise<Result<RemoveBoardResult, MutationError>> {
  return withBoardLock(args.boardId, () => removeBoardImpl(ctx, args));
}

// ── Frame / group lifecycle ────────────────────────────────────
export function addFrame(
  ctx: MutationContext,
  args: AddFrameArgs,
): Promise<Result<AddFrameResult, MutationError>> {
  return withBoardLock(args.boardId, () => addFrameImpl(ctx, args));
}
export function updateFrame(
  ctx: MutationContext,
  args: UpdateFrameArgs,
): Promise<Result<UpdateFrameResult, MutationError>> {
  return withBoardLock(args.boardId, () => updateFrameImpl(ctx, args));
}
export function updateFrames(
  ctx: MutationContext,
  args: UpdateFramesArgs,
): Promise<Result<UpdateFramesResult, MutationError>> {
  return withBoardLock(args.boardId, () => updateFramesImpl(ctx, args));
}
export function removeFrame(
  ctx: MutationContext,
  args: RemoveFrameArgs,
): Promise<Result<RemoveFrameResult, MutationError>> {
  return withBoardLock(args.boardId, () => removeFrameImpl(ctx, args));
}
export function addGroup(
  ctx: MutationContext,
  args: AddGroupArgs,
): Promise<Result<AddGroupResult, MutationError>> {
  return withBoardLock(args.boardId, () => addGroupImpl(ctx, args));
}
export function updateGroup(
  ctx: MutationContext,
  args: UpdateGroupArgs,
): Promise<Result<UpdateGroupResult, MutationError>> {
  return withBoardLock(args.boardId, () => updateGroupImpl(ctx, args));
}
export function removeGroup(
  ctx: MutationContext,
  args: RemoveGroupArgs,
): Promise<Result<RemoveGroupResult, MutationError>> {
  return withBoardLock(args.boardId, () => removeGroupImpl(ctx, args));
}

// ── Annotations & notes ────────────────────────────────────────
export function addAnnotation(
  ctx: MutationContext,
  args: AddAnnotationArgs,
): Promise<Result<AnnotationResult, MutationError>> {
  return withScreenLock(args.screenId, () => addAnnotationImpl(ctx, args));
}
export function updateAnnotation(
  ctx: MutationContext,
  args: UpdateAnnotationArgs,
): Promise<Result<AnnotationResult, MutationError>> {
  return withScreenLock(args.screenId, () => updateAnnotationImpl(ctx, args));
}
export function removeAnnotation(
  ctx: MutationContext,
  args: RemoveAnnotationArgs,
): Promise<Result<{ removedId: string }, MutationError>> {
  return withScreenLock(args.screenId, () => removeAnnotationImpl(ctx, args));
}
export function addNote(
  ctx: MutationContext,
  args: AddNoteArgs,
): Promise<Result<NoteResult, MutationError>> {
  return withBoardLock(args.boardId, () => addNoteImpl(ctx, args));
}
export function updateNote(
  ctx: MutationContext,
  args: UpdateNoteArgs,
): Promise<Result<NoteResult, MutationError>> {
  return withBoardLock(args.boardId, () => updateNoteImpl(ctx, args));
}
export function removeNote(
  ctx: MutationContext,
  args: RemoveNoteArgs,
): Promise<Result<{ removedId: string }, MutationError>> {
  return withBoardLock(args.boardId, () => removeNoteImpl(ctx, args));
}

// ── Snippets ───────────────────────────────────────────────────
export function addSnippet(
  ctx: MutationContext,
  args: AddSnippetArgs,
): Promise<Result<AddSnippetResult, MutationError>> {
  return withSnippetLock(args.id ?? args.name, () => addSnippetImpl(ctx, args));
}
export function updateSnippet(
  ctx: MutationContext,
  args: UpdateSnippetArgs,
): Promise<Result<UpdateSnippetResult, MutationError>> {
  return withSnippetLock(args.snippetId, () => updateSnippetImpl(ctx, args));
}
export function removeSnippet(
  ctx: MutationContext,
  args: RemoveSnippetArgs,
): Promise<Result<RemoveSnippetResult, MutationError>> {
  return withSnippetLock(args.snippetId, () => removeSnippetImpl(ctx, args));
}
export function instantiateSnippet(
  ctx: MutationContext,
  args: InstantiateSnippetArgs,
): Promise<Result<InstantiateSnippetResult, MutationError>> {
  return withScreenLock(args.screenId, () => instantiateSnippetImpl(ctx, args));
}
export function updateSnippetArgs(
  ctx: MutationContext,
  args: UpdateSnippetArgsArgs,
): Promise<Result<UpdateSnippetArgsResult, MutationError>> {
  return withScreenLock(args.screenId, () => updateSnippetArgsImpl(ctx, args));
}

// ── Read-only ──────────────────────────────────────────────────
export function inspect(
  ctx: MutationContext,
  args: InspectArgs,
): Promise<Result<InspectResult, MutationError>> {
  return inspectImpl(ctx, args);
}
export function darkModeAudit(
  ctx: MutationContext,
  args: DarkModeAuditArgs,
): Promise<Result<DarkModeAuditResult, MutationError>> {
  return darkModeAuditImpl(ctx, args);
}
export function auditSnippet(
  ctx: MutationContext,
  args: AuditSnippetArgs,
): Promise<Result<DarkModeAuditResult, MutationError>> {
  return auditSnippetImpl(ctx, args);
}

export type { MutationError } from "./errors.ts";
export type {
  AddAnnotationArgs,
  AddBoardArgs,
  AddBoardResult,
  AddFrameArgs,
  AddFrameResult,
  AddGroupArgs,
  AddGroupResult,
  AddNodeArgs,
  AddNodeResult,
  AddNoteArgs,
  AddScreenArgs,
  AddScreenResult,
  AddSnippetArgs,
  AddSnippetResult,
  AnnotationResult,
  ApplyClassesArgs,
  ApplyClassesBulkArgs,
  AuditSnippetArgs,
  DarkModeAuditArgs,
  DarkModeAuditResult,
  InspectArgs,
  InspectResult,
  InstantiateSnippetArgs,
  InstantiateSnippetResult,
  MoveNodeArgs,
  MoveNodeResult,
  MutationContext,
  NoteResult,
  RemoveAnnotationArgs,
  RemoveBoardArgs,
  RemoveBoardResult,
  RemoveFrameArgs,
  RemoveFrameResult,
  RemoveGroupArgs,
  RemoveGroupResult,
  RemoveNodeArgs,
  RemoveNodeResult,
  RemoveNoteArgs,
  RemoveScreenArgs,
  RemoveScreenResult,
  RemoveSnippetArgs,
  RemoveSnippetResult,
  SetNodeIdArgs,
  SetNodeIdResult,
  UpdateAnnotationArgs,
  UpdateBoardArgs,
  UpdateBoardResult,
  UpdateFrameArgs,
  UpdateFrameResult,
  UpdateFramesArgs,
  UpdateFramesResult,
  UpdateGroupArgs,
  UpdateGroupResult,
  UpdateNoteArgs,
  UpdatePropsArgs,
  UpdatePropsBulkArgs,
  UpdatePropsBulkResult,
  UpdatePropsResult,
  UpdateScreenArgs,
  UpdateScreenResult,
  UpdateSnippetArgs,
  UpdateSnippetArgsArgs,
  UpdateSnippetArgsResult,
  UpdateSnippetResult,
};
