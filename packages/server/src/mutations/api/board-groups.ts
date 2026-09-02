import type { Result } from "@velloo/result";
import { tracked } from "../../activity.ts";
import {
  type AddBoardGroupArgs,
  type AddBoardGroupResult,
  addBoardGroup as addBoardGroupImpl,
  type RemoveBoardGroupArgs,
  type RemoveBoardGroupResult,
  type ReorderBoardGroupsArgs,
  type ReorderBoardGroupsResult,
  removeBoardGroup as removeBoardGroupImpl,
  reorderBoardGroups as reorderBoardGroupsImpl,
  type UpdateBoardGroupArgs,
  type UpdateBoardGroupResult,
  updateBoardGroup as updateBoardGroupImpl,
} from "../board-groups.ts";
import type { MutationContext } from "../context.ts";
import type { MutationError } from "../errors.ts";

// Group CRUD writes folder config (and, on remove, the member board files),
// so there's no single board to lock against — same shape as reorderBoards.
export function addBoardGroup(
  ctx: MutationContext,
  args: AddBoardGroupArgs,
): Promise<Result<AddBoardGroupResult, MutationError>> {
  return tracked(ctx, "add_board_group", {}, () => addBoardGroupImpl(ctx, args));
}
export function updateBoardGroup(
  ctx: MutationContext,
  args: UpdateBoardGroupArgs,
): Promise<Result<UpdateBoardGroupResult, MutationError>> {
  return tracked(ctx, "update_board_group", {}, () => updateBoardGroupImpl(ctx, args));
}
export function removeBoardGroup(
  ctx: MutationContext,
  args: RemoveBoardGroupArgs,
): Promise<Result<RemoveBoardGroupResult, MutationError>> {
  return tracked(ctx, "remove_board_group", {}, () => removeBoardGroupImpl(ctx, args));
}
export function reorderBoardGroups(
  ctx: MutationContext,
  args: ReorderBoardGroupsArgs,
): Promise<Result<ReorderBoardGroupsResult, MutationError>> {
  return tracked(ctx, "reorder_board_groups", {}, () => reorderBoardGroupsImpl(ctx, args));
}

export type {
  AddBoardGroupArgs,
  AddBoardGroupResult,
  RemoveBoardGroupArgs,
  RemoveBoardGroupResult,
  ReorderBoardGroupsArgs,
  ReorderBoardGroupsResult,
  UpdateBoardGroupArgs,
  UpdateBoardGroupResult,
};
