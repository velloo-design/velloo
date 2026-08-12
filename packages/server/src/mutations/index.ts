import type { Result } from "@velloo/result";
import { type AddNodeArgs, type AddNodeResult, addNode as addNodeImpl } from "./add-node.ts";
import { type AddPageArgs, type AddPageResult, addPage as addPageImpl } from "./add-page.ts";
import {
  type AddVariantArgs,
  type AddVariantResult,
  addVariant as addVariantImpl,
} from "./add-variant.ts";
import { type ApplyClassesArgs, applyClasses as applyClassesImpl } from "./apply-classes.ts";
import type { MutationContext } from "./context.ts";
import { withPageLock } from "./context.ts";
import type { MutationError } from "./errors.ts";
import { type InspectArgs, type InspectResult, inspect as inspectImpl } from "./inspect.ts";
import { type MoveNodeArgs, type MoveNodeResult, moveNode as moveNodeImpl } from "./move-node.ts";
import {
  type RemoveNodeArgs,
  type RemoveNodeResult,
  removeNode as removeNodeImpl,
} from "./remove-node.ts";
import {
  type RemovePageArgs,
  type RemovePageResult,
  removePage as removePageImpl,
} from "./remove-page.ts";
import {
  type RemoveVariantArgs,
  type RemoveVariantResult,
  removeVariant as removeVariantImpl,
} from "./remove-variant.ts";
import {
  type UpdatePropsArgs,
  type UpdatePropsResult,
  updateProps as updatePropsImpl,
} from "./update-props.ts";
import {
  type UpdateVariantArgs,
  type UpdateVariantResult,
  updateVariant as updateVariantImpl,
} from "./update-variant.ts";
import {
  type UpdateVariantsArgs,
  type UpdateVariantsResult,
  updateVariants as updateVariantsImpl,
} from "./update-variants.ts";

/** Wrap each write mutation with the per-page mutex. Result flows through `T`. */
export function addNode(
  ctx: MutationContext,
  args: AddNodeArgs,
): Promise<Result<AddNodeResult, MutationError>> {
  return withPageLock(args.pageId, () => addNodeImpl(ctx, args));
}
export function updateProps(
  ctx: MutationContext,
  args: UpdatePropsArgs,
): Promise<Result<UpdatePropsResult, MutationError>> {
  return withPageLock(args.pageId, () => updatePropsImpl(ctx, args));
}
export function moveNode(
  ctx: MutationContext,
  args: MoveNodeArgs,
): Promise<Result<MoveNodeResult, MutationError>> {
  return withPageLock(args.pageId, () => moveNodeImpl(ctx, args));
}
export function removeNode(
  ctx: MutationContext,
  args: RemoveNodeArgs,
): Promise<Result<RemoveNodeResult, MutationError>> {
  return withPageLock(args.pageId, () => removeNodeImpl(ctx, args));
}
export function addVariant(
  ctx: MutationContext,
  args: AddVariantArgs,
): Promise<Result<AddVariantResult, MutationError>> {
  return withPageLock(args.pageId, () => addVariantImpl(ctx, args));
}
export function removeVariant(
  ctx: MutationContext,
  args: RemoveVariantArgs,
): Promise<Result<RemoveVariantResult, MutationError>> {
  return withPageLock(args.pageId, () => removeVariantImpl(ctx, args));
}
export function addPage(
  ctx: MutationContext,
  args: AddPageArgs,
): Promise<Result<AddPageResult, MutationError>> {
  return addPageImpl(ctx, args);
}
export function removePage(
  ctx: MutationContext,
  args: RemovePageArgs,
): Promise<Result<RemovePageResult, MutationError>> {
  return withPageLock(args.pageId, () => removePageImpl(ctx, args));
}
export function applyClasses(
  ctx: MutationContext,
  args: ApplyClassesArgs,
): Promise<Result<UpdatePropsResult, MutationError>> {
  return withPageLock(args.pageId, () => applyClassesImpl(ctx, args));
}
export function updateVariant(
  ctx: MutationContext,
  args: UpdateVariantArgs,
): Promise<Result<UpdateVariantResult, MutationError>> {
  return withPageLock(args.pageId, () => updateVariantImpl(ctx, args));
}
export function updateVariants(
  ctx: MutationContext,
  args: UpdateVariantsArgs,
): Promise<Result<UpdateVariantsResult, MutationError>> {
  return withPageLock(args.pageId, () => updateVariantsImpl(ctx, args));
}

/** inspect is read-only; no mutex needed. */
export function inspect(
  ctx: MutationContext,
  args: InspectArgs,
): Promise<Result<InspectResult, MutationError>> {
  return inspectImpl(ctx, args);
}

export type { MutationError } from "./errors.ts";
export type {
  AddNodeArgs,
  AddNodeResult,
  AddPageArgs,
  AddPageResult,
  AddVariantArgs,
  AddVariantResult,
  ApplyClassesArgs,
  InspectArgs,
  InspectResult,
  MoveNodeArgs,
  MoveNodeResult,
  MutationContext,
  RemoveNodeArgs,
  RemoveNodeResult,
  RemovePageArgs,
  RemovePageResult,
  RemoveVariantArgs,
  RemoveVariantResult,
  UpdatePropsArgs,
  UpdatePropsResult,
  UpdateVariantArgs,
  UpdateVariantResult,
  UpdateVariantsArgs,
  UpdateVariantsResult,
};
