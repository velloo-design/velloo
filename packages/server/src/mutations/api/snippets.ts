import type { Result } from "@velloo/result";
import {
  type AddSnippetArgs,
  type AddSnippetResult,
  addSnippet as addSnippetImpl,
} from "../add-snippet.ts";
import type { MutationContext } from "../context.ts";
import { withScreenLock, withSnippetLock } from "../context.ts";
import type { MutationError } from "../errors.ts";
import {
  type InstantiateSnippetArgs,
  type InstantiateSnippetResult,
  instantiateSnippet as instantiateSnippetImpl,
} from "../instantiate-snippet.ts";
import {
  type RemoveSnippetArgs,
  type RemoveSnippetResult,
  removeSnippet as removeSnippetImpl,
} from "../remove-snippet.ts";
import {
  type UpdateSnippetArgs,
  type UpdateSnippetResult,
  updateSnippet as updateSnippetImpl,
} from "../update-snippet.ts";
import {
  type UpdateSnippetArgsArgs,
  type UpdateSnippetArgsResult,
  updateSnippetArgs as updateSnippetArgsImpl,
} from "../update-snippet-args.ts";

export function addSnippet(
  ctx: MutationContext,
  args: AddSnippetArgs,
): Promise<Result<AddSnippetResult, MutationError>> {
  return withSnippetLock(ctx.folder, args.id ?? args.name, () => addSnippetImpl(ctx, args));
}
export function updateSnippet(
  ctx: MutationContext,
  args: UpdateSnippetArgs,
): Promise<Result<UpdateSnippetResult, MutationError>> {
  return withSnippetLock(ctx.folder, args.snippetId, () => updateSnippetImpl(ctx, args));
}
export function removeSnippet(
  ctx: MutationContext,
  args: RemoveSnippetArgs,
): Promise<Result<RemoveSnippetResult, MutationError>> {
  return withSnippetLock(ctx.folder, args.snippetId, () => removeSnippetImpl(ctx, args));
}
export function instantiateSnippet(
  ctx: MutationContext,
  args: InstantiateSnippetArgs,
): Promise<Result<InstantiateSnippetResult, MutationError>> {
  return withScreenLock(ctx.folder, args.screenId, () => instantiateSnippetImpl(ctx, args));
}
export function updateSnippetArgs(
  ctx: MutationContext,
  args: UpdateSnippetArgsArgs,
): Promise<Result<UpdateSnippetArgsResult, MutationError>> {
  return withScreenLock(ctx.folder, args.screenId, () => updateSnippetArgsImpl(ctx, args));
}

export type {
  AddSnippetArgs,
  AddSnippetResult,
  InstantiateSnippetArgs,
  InstantiateSnippetResult,
  RemoveSnippetArgs,
  RemoveSnippetResult,
  UpdateSnippetArgs,
  UpdateSnippetArgsArgs,
  UpdateSnippetArgsResult,
  UpdateSnippetResult,
};
