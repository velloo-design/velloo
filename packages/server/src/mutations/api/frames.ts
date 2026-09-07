import type { Result } from "@velloo/result";
import { tracked } from "../../activity.ts";
import { type AddFrameArgs, type AddFrameResult, addFrame as addFrameImpl } from "../add-frame.ts";
import type { MutationContext } from "../context.ts";
import { withBoardLock, withBoardLocks } from "../context.ts";
import type { MutationError } from "../errors.ts";
import {
  type MoveFrameArgs,
  type MoveFrameResult,
  moveFrame as moveFrameImpl,
} from "../move-frame.ts";
import {
  type RemoveFrameArgs,
  type RemoveFrameResult,
  removeFrame as removeFrameImpl,
} from "../remove-frame.ts";
import {
  type UpdateFramesArgs,
  type UpdateFramesResult,
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
export function updateFrames(
  ctx: MutationContext,
  args: UpdateFramesArgs,
): Promise<Result<UpdateFramesResult, MutationError>> {
  return tracked(ctx, "update_frame", { boardId: args.boardId }, () =>
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
export function moveFrame(
  ctx: MutationContext,
  args: MoveFrameArgs,
): Promise<Result<MoveFrameResult, MutationError>> {
  // Both boards are written as one act, so both locks are held for the whole
  // move — the target can't be mutated between the add and the removal.
  return tracked(
    ctx,
    "move_frame",
    (v) => ({ boardId: v.toBoardId, frameId: v.frame.id, screenId: v.frame.screen }),
    () =>
      withBoardLocks(ctx.folder, [args.boardId, args.toBoardId], () => moveFrameImpl(ctx, args)),
  );
}

export type {
  AddFrameArgs,
  AddFrameResult,
  MoveFrameArgs,
  MoveFrameResult,
  RemoveFrameArgs,
  RemoveFrameResult,
  UpdateFramesArgs,
  UpdateFramesResult,
};
