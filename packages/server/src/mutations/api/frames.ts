import type { Result } from "@velloo/result";
import { tracked } from "../../activity.ts";
import { type AddFrameArgs, type AddFrameResult, addFrame as addFrameImpl } from "../add-frame.ts";
import type { MutationContext } from "../context.ts";
import { withBoardLock } from "../context.ts";
import type { MutationError } from "../errors.ts";
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
  return tracked(
    ctx,
    "add_frame",
    (v) => ({ boardId: args.boardId, frameId: v.frame.id, screenId: v.frame.screen }),
    () => withBoardLock(ctx.folder, args.boardId, () => addFrameImpl(ctx, args)),
  );
}
export function updateFrame(
  ctx: MutationContext,
  args: UpdateFrameArgs,
): Promise<Result<UpdateFrameResult, MutationError>> {
  return tracked(ctx, "update_frame", { boardId: args.boardId, frameId: args.frameId }, () =>
    withBoardLock(ctx.folder, args.boardId, () => updateFrameImpl(ctx, args)),
  );
}
export function updateFrames(
  ctx: MutationContext,
  args: UpdateFramesArgs,
): Promise<Result<UpdateFramesResult, MutationError>> {
  return tracked(ctx, "update_frames", { boardId: args.boardId }, () =>
    withBoardLock(ctx.folder, args.boardId, () => updateFramesImpl(ctx, args)),
  );
}
export function removeFrame(
  ctx: MutationContext,
  args: RemoveFrameArgs,
): Promise<Result<RemoveFrameResult, MutationError>> {
  return tracked(ctx, "remove_frame", { boardId: args.boardId, frameId: args.frameId }, () =>
    withBoardLock(ctx.folder, args.boardId, () => removeFrameImpl(ctx, args)),
  );
}

export type {
  AddFrameArgs,
  AddFrameResult,
  RemoveFrameArgs,
  RemoveFrameResult,
  UpdateFrameArgs,
  UpdateFrameResult,
  UpdateFramesArgs,
  UpdateFramesResult,
};
