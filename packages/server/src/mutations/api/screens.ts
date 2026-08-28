import type { Result } from "@velloo/result";
import { tracked } from "../../activity.ts";
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
  return tracked(
    ctx,
    "add_screen",
    (v) => ({ screenId: v.screenId }),
    () => addScreenImpl(ctx, args),
  );
}
export function removeScreen(
  ctx: MutationContext,
  args: RemoveScreenArgs,
): Promise<Result<RemoveScreenResult, MutationError>> {
  return tracked(ctx, "remove_screen", { screenId: args.screenId }, () =>
    withScreenLock(ctx.folder, args.screenId, () => removeScreenImpl(ctx, args)),
  );
}
export function updateScreen(
  ctx: MutationContext,
  args: UpdateScreenArgs,
): Promise<Result<UpdateScreenResult, MutationError>> {
  return tracked(ctx, "update_screen", { screenId: args.screenId }, () =>
    withScreenLock(ctx.folder, args.screenId, () => updateScreenImpl(ctx, args)),
  );
}
export function setScreenTree(
  ctx: MutationContext,
  args: SetScreenTreeArgs,
): Promise<Result<SetScreenTreeResult, MutationError>> {
  // Whole-tree replace: inherently ONE screen-level activity event — the
  // grouped shape for this verb (never a per-node flood). See activity.ts.
  return tracked(ctx, "set_screen_tree", { screenId: args.screenId }, () =>
    withScreenLock(ctx.folder, args.screenId, () => setScreenTreeImpl(ctx, args)),
  );
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
