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
  removeScreenStrict as removeScreenStrictImpl,
} from "../remove-screen.ts";
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

export type {
  AddScreenArgs,
  AddScreenResult,
  RemoveScreenArgs,
  RemoveScreenResult,
  UpdateScreenArgs,
  UpdateScreenResult,
};
