import type { Result } from "@velloo/result";
import { tracked } from "../../activity.ts";
import { type AddNodeArgs, type AddNodeResult, addNode as addNodeImpl } from "../add-node.ts";
import { type ApplyClassesArgs, applyClasses as applyClassesImpl } from "../apply-classes.ts";
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
  return tracked(
    ctx,
    "add_node",
    (v) => ({ screenId: args.screenId, path: v.path }),
    () => withScreenLock(ctx.folder, args.screenId, () => addNodeImpl(ctx, args)),
  );
}
export function updateProps(
  ctx: MutationContext,
  args: UpdatePropsArgs,
): Promise<Result<UpdatePropsResult, MutationError>> {
  return tracked(
    ctx,
    "update_props",
    (v) => ({ screenId: args.screenId, path: v.path }),
    () => withScreenLock(ctx.folder, args.screenId, () => updatePropsImpl(ctx, args)),
  );
}
export function moveNode(
  ctx: MutationContext,
  args: MoveNodeArgs,
): Promise<Result<MoveNodeResult, MutationError>> {
  return tracked(
    ctx,
    "move_node",
    (v) => ({ screenId: args.screenId, path: v.newPath }),
    () => withScreenLock(ctx.folder, args.screenId, () => moveNodeImpl(ctx, args)),
  );
}
export function removeNode(
  ctx: MutationContext,
  args: RemoveNodeArgs,
): Promise<Result<RemoveNodeResult, MutationError>> {
  return tracked(ctx, "remove_node", { screenId: args.screenId }, () =>
    withScreenLock(ctx.folder, args.screenId, () => removeNodeImpl(ctx, args)),
  );
}
export function applyClasses(
  ctx: MutationContext,
  args: ApplyClassesArgs,
): Promise<Result<UpdatePropsResult, MutationError>> {
  return tracked(
    ctx,
    "apply_classes",
    (v) => ({ screenId: args.screenId, path: v.path }),
    () => withScreenLock(ctx.folder, args.screenId, () => applyClassesImpl(ctx, args)),
  );
}
export function updatePropsBulk(
  ctx: MutationContext,
  args: UpdatePropsBulkArgs,
): Promise<Result<UpdatePropsBulkResult, MutationError>> {
  return tracked(ctx, "update_props_bulk", { screenId: args.screenId }, () =>
    withScreenLock(ctx.folder, args.screenId, () => updatePropsBulkImpl(ctx, args)),
  );
}
export function setNodeId(
  ctx: MutationContext,
  args: SetNodeIdArgs,
): Promise<Result<SetNodeIdResult, MutationError>> {
  return tracked(
    ctx,
    "set_node_id",
    (v) => ({ screenId: args.screenId, path: v.path }),
    () => withScreenLock(ctx.folder, args.screenId, () => setNodeIdImpl(ctx, args)),
  );
}

export type {
  AddNodeArgs,
  AddNodeResult,
  ApplyClassesArgs,
  MoveNodeArgs,
  MoveNodeResult,
  RemoveNodeArgs,
  RemoveNodeResult,
  SetNodeIdArgs,
  SetNodeIdResult,
  UpdatePropsArgs,
  UpdatePropsBulkArgs,
  UpdatePropsBulkResult,
  UpdatePropsResult,
};

export function overrideSnippetProps(
  ctx: MutationContext,
  args: OverrideSnippetPropsArgs,
): Promise<Result<OverrideSnippetPropsResult, MutationError>> {
  return tracked(
    ctx,
    "override_snippet_props",
    (v) => ({ screenId: args.screenId, path: v.path }),
    () => withScreenLock(ctx.folder, args.screenId, () => overrideSnippetPropsImpl(ctx, args)),
  );
}
export type { OverrideSnippetPropsArgs, OverrideSnippetPropsResult };
