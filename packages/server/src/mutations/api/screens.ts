import type { Result } from "@velloo/result";
import {
  type AddScreenArgs,
  type AddScreenResult,
  addScreen as addScreenImpl,
} from "../add-screen.ts";
import type { MutationContext } from "../context.ts";
import { withScreenLock } from "../context.ts";
import type { MutationError } from "../errors.ts";
import {
  type RemoveScreenArgs,
  type RemoveScreenResult,
  removeScreen as removeScreenImpl,
} from "../remove-screen.ts";
import {
  type SetScreenTreeArgs,
  type SetScreenTreeResult,
  setScreenTree as setScreenTreeImpl,
} from "../set-screen-tree.ts";
import {
  type UpdateScreenArgs,
  type UpdateScreenResult,
  updateScreen as updateScreenImpl,
} from "../update-screen.ts";

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
  return withScreenLock(ctx.folder, args.screenId, () => removeScreenImpl(ctx, args));
}
export function updateScreen(
  ctx: MutationContext,
  args: UpdateScreenArgs,
): Promise<Result<UpdateScreenResult, MutationError>> {
  return withScreenLock(ctx.folder, args.screenId, () => updateScreenImpl(ctx, args));
}
export function setScreenTree(
  ctx: MutationContext,
  args: SetScreenTreeArgs,
): Promise<Result<SetScreenTreeResult, MutationError>> {
  return withScreenLock(ctx.folder, args.screenId, () => setScreenTreeImpl(ctx, args));
}

export type {
  AddScreenArgs,
  AddScreenResult,
  RemoveScreenArgs,
  RemoveScreenResult,
  SetScreenTreeArgs,
  SetScreenTreeResult,
  UpdateScreenArgs,
  UpdateScreenResult,
};
