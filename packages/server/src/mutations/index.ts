import { type AddNodeArgs, type AddNodeResult, addNode as addNodeImpl } from "./add-node.ts";
import {
  type AddVariantArgs,
  type AddVariantResult,
  addVariant as addVariantImpl,
} from "./add-variant.ts";
import { type ApplyClassesArgs, applyClasses as applyClassesImpl } from "./apply-classes.ts";
import type { MutationContext } from "./context.ts";
import { withPageLock } from "./context.ts";
import { type InspectArgs, type InspectResult, inspect as inspectImpl } from "./inspect.ts";
import { type MoveNodeArgs, type MoveNodeResult, moveNode as moveNodeImpl } from "./move-node.ts";
import {
  type RemoveNodeArgs,
  type RemoveNodeResult,
  removeNode as removeNodeImpl,
} from "./remove-node.ts";
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

/** Wrap each write mutation with the per-page mutex. */
export function addNode(ctx: MutationContext, args: AddNodeArgs): Promise<AddNodeResult> {
  return withPageLock(args.pageId, () => addNodeImpl(ctx, args));
}
export function updateProps(
  ctx: MutationContext,
  args: UpdatePropsArgs,
): Promise<UpdatePropsResult> {
  return withPageLock(args.pageId, () => updatePropsImpl(ctx, args));
}
export function moveNode(ctx: MutationContext, args: MoveNodeArgs): Promise<MoveNodeResult> {
  return withPageLock(args.pageId, () => moveNodeImpl(ctx, args));
}
export function removeNode(ctx: MutationContext, args: RemoveNodeArgs): Promise<RemoveNodeResult> {
  return withPageLock(args.pageId, () => removeNodeImpl(ctx, args));
}
export function addVariant(ctx: MutationContext, args: AddVariantArgs): Promise<AddVariantResult> {
  return withPageLock(args.pageId, () => addVariantImpl(ctx, args));
}
export function applyClasses(
  ctx: MutationContext,
  args: ApplyClassesArgs,
): Promise<UpdatePropsResult> {
  return withPageLock(args.pageId, () => applyClassesImpl(ctx, args));
}
export function updateVariant(
  ctx: MutationContext,
  args: UpdateVariantArgs,
): Promise<UpdateVariantResult> {
  return withPageLock(args.pageId, () => updateVariantImpl(ctx, args));
}

/** inspect is read-only; no mutex needed. */
export function inspect(ctx: MutationContext, args: InspectArgs): Promise<InspectResult> {
  return inspectImpl(ctx, args);
}

export { MutationError, type MutationErrorCode, type MutationErrorPayload } from "./errors.ts";
export type {
  AddNodeArgs,
  AddNodeResult,
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
  UpdatePropsArgs,
  UpdatePropsResult,
  UpdateVariantArgs,
  UpdateVariantResult,
};
