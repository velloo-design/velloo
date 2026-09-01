import type { Result } from "@velloo/result";
import { tracked } from "../../activity.ts";
import {
  type UpdateCodegenArgs,
  type UpdateCodegenResult,
  type UpdateDefaultsArgs,
  type UpdateDefaultsResult,
  type UpdateFeedbackArgs,
  type UpdateFeedbackResult,
  type UpdateViewportPresetsArgs,
  type UpdateViewportPresetsResult,
  updateCodegen as updateCodegenImpl,
  updateDefaults as updateDefaultsImpl,
  updateFeedback as updateFeedbackImpl,
  updateViewportPresets as updateViewportPresetsImpl,
} from "../config.ts";
import type { MutationContext } from "../context.ts";
import { withConfigLock } from "../context.ts";
import type { MutationError } from "../errors.ts";

export function updateViewportPresets(
  ctx: MutationContext,
  args: UpdateViewportPresetsArgs,
): Promise<Result<UpdateViewportPresetsResult, MutationError>> {
  return tracked(ctx, "update_viewport_presets", {}, () =>
    withConfigLock(ctx.folder, () => updateViewportPresetsImpl(ctx, args)),
  );
}

export function updateDefaults(
  ctx: MutationContext,
  args: UpdateDefaultsArgs,
): Promise<Result<UpdateDefaultsResult, MutationError>> {
  return tracked(ctx, "update_defaults", {}, () =>
    withConfigLock(ctx.folder, () => updateDefaultsImpl(ctx, args)),
  );
}

export function updateCodegen(
  ctx: MutationContext,
  args: UpdateCodegenArgs,
): Promise<Result<UpdateCodegenResult, MutationError>> {
  return tracked(ctx, "update_codegen", {}, () =>
    withConfigLock(ctx.folder, () => updateCodegenImpl(ctx, args)),
  );
}

export function updateFeedback(
  ctx: MutationContext,
  args: UpdateFeedbackArgs,
): Promise<Result<UpdateFeedbackResult, MutationError>> {
  return tracked(ctx, "update_feedback", {}, () =>
    withConfigLock(ctx.folder, () => updateFeedbackImpl(ctx, args)),
  );
}

export type {
  UpdateCodegenArgs,
  UpdateCodegenResult,
  UpdateDefaultsArgs,
  UpdateDefaultsResult,
  UpdateFeedbackArgs,
  UpdateFeedbackResult,
  UpdateViewportPresetsArgs,
  UpdateViewportPresetsResult,
};
