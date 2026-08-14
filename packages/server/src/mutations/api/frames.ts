import type { Result } from "@velloo/result";
import { type AddFrameArgs, type AddFrameResult, addFrame as addFrameImpl } from "../add-frame.ts";
import type { MutationContext } from "../context.ts";
import { withBoardLock } from "../context.ts";
import type { MutationError } from "../errors.ts";
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
} from "../groups.ts";
import {
  type RemoveFrameArgs,
  type RemoveFrameResult,
  removeFrame as removeFrameImpl,
} from "../remove-frame.ts";
import {
  type UpdateFrameArgs,
  type UpdateFrameResult,
  type UpdateFramesArgs,
  type UpdateFramesResult,
  updateFrame as updateFrameImpl,
  updateFrames as updateFramesImpl,
} from "../update-frame.ts";

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

export type {
  AddFrameArgs,
  AddFrameResult,
  AddGroupArgs,
  AddGroupResult,
  RemoveFrameArgs,
  RemoveFrameResult,
  RemoveGroupArgs,
  RemoveGroupResult,
  UpdateFrameArgs,
  UpdateFrameResult,
  UpdateFramesArgs,
  UpdateFramesResult,
  UpdateGroupArgs,
  UpdateGroupResult,
};
