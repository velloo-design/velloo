import type { Result } from "@velloo/result";
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
} from "../boards.ts";
import type { MutationContext } from "../context.ts";
import { withBoardLock } from "../context.ts";
import type { MutationError } from "../errors.ts";

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

export type {
  AddBoardArgs,
  AddBoardResult,
  RemoveBoardArgs,
  RemoveBoardResult,
  UpdateBoardArgs,
  UpdateBoardResult,
};
