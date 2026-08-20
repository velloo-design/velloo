import type { Result } from "@velloo/result";
import { type AddNodeArgs, type AddNodeResult, addNode as addNodeImpl } from "../add-node.ts";
import { type ApplyClassesArgs, applyClasses as applyClassesImpl } from "../apply-classes.ts";
import {
  type ApplyClassesBulkArgs,
  applyClassesBulk as applyClassesBulkImpl,
} from "../apply-classes-bulk.ts";
import type { MutationContext } from "../context.ts";
import { withScreenLock } from "../context.ts";
import type { MutationError } from "../errors.ts";
import { type MoveNodeArgs, type MoveNodeResult, moveNode as moveNodeImpl } from "../move-node.ts";
import {
  type OverrideSnippetPropsArgs,
  type OverrideSnippetPropsResult,
  overrideSnippetProps as overrideSnippetPropsImpl,
} from "../override-snippet-props.ts";
import {
  type RemoveNodeArgs,
  type RemoveNodeResult,
  removeNode as removeNodeImpl,
} from "../remove-node.ts";
import {
  type SetNodeIdArgs,
  type SetNodeIdResult,
  setNodeId as setNodeIdImpl,
} from "../set-node-id.ts";
import { type SetStyleArgs, setStyle as setStyleImpl } from "../set-style.ts";
import {
  type UpdatePropsArgs,
  type UpdatePropsResult,
  updateProps as updatePropsImpl,
} from "../update-props.ts";
import {
  type UpdatePropsBulkArgs,
  type UpdatePropsBulkResult,
  updatePropsBulk as updatePropsBulkImpl,
} from "../update-props-bulk.ts";

export function addNode(
  ctx: MutationContext,
  args: AddNodeArgs,
): Promise<Result<AddNodeResult, MutationError>> {
  return withScreenLock(args.screenId, () => addNodeImpl(ctx, args));
}
export function updateProps(
  ctx: MutationContext,
  args: UpdatePropsArgs,
): Promise<Result<UpdatePropsResult, MutationError>> {
  return withScreenLock(args.screenId, () => updatePropsImpl(ctx, args));
}
export function moveNode(
  ctx: MutationContext,
  args: MoveNodeArgs,
): Promise<Result<MoveNodeResult, MutationError>> {
  return withScreenLock(args.screenId, () => moveNodeImpl(ctx, args));
}
export function removeNode(
  ctx: MutationContext,
  args: RemoveNodeArgs,
): Promise<Result<RemoveNodeResult, MutationError>> {
  return withScreenLock(args.screenId, () => removeNodeImpl(ctx, args));
}
export function applyClasses(
  ctx: MutationContext,
  args: ApplyClassesArgs,
): Promise<Result<UpdatePropsResult, MutationError>> {
  return withScreenLock(args.screenId, () => applyClassesImpl(ctx, args));
}
export function applyClassesBulk(
  ctx: MutationContext,
  args: ApplyClassesBulkArgs,
): Promise<Result<UpdatePropsBulkResult, MutationError>> {
  return withScreenLock(args.screenId, () => applyClassesBulkImpl(ctx, args));
}
export function updatePropsBulk(
  ctx: MutationContext,
  args: UpdatePropsBulkArgs,
): Promise<Result<UpdatePropsBulkResult, MutationError>> {
  return withScreenLock(args.screenId, () => updatePropsBulkImpl(ctx, args));
}
export function setNodeId(
  ctx: MutationContext,
  args: SetNodeIdArgs,
): Promise<Result<SetNodeIdResult, MutationError>> {
  return withScreenLock(args.screenId, () => setNodeIdImpl(ctx, args));
}
export function setStyle(
  ctx: MutationContext,
  args: SetStyleArgs,
): Promise<Result<UpdatePropsResult, MutationError>> {
  return withScreenLock(args.screenId, () => setStyleImpl(ctx, args));
}

export type {
  AddNodeArgs,
  AddNodeResult,
  ApplyClassesArgs,
  ApplyClassesBulkArgs,
  MoveNodeArgs,
  MoveNodeResult,
  RemoveNodeArgs,
  RemoveNodeResult,
  SetNodeIdArgs,
  SetNodeIdResult,
  SetStyleArgs,
  UpdatePropsArgs,
  UpdatePropsBulkArgs,
  UpdatePropsBulkResult,
  UpdatePropsResult,
};

export function overrideSnippetProps(
  ctx: MutationContext,
  args: OverrideSnippetPropsArgs,
): Promise<Result<OverrideSnippetPropsResult, MutationError>> {
  return withScreenLock(args.screenId, () => overrideSnippetPropsImpl(ctx, args));
}
export type { OverrideSnippetPropsArgs, OverrideSnippetPropsResult };
