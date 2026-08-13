import type { Result } from "@velloo/result";
import { type AddNodeArgs, type AddNodeResult, addNode as addNodeImpl } from "./add-node.ts";
import { type AddPageArgs, type AddPageResult, addPage as addPageImpl } from "./add-page.ts";
import {
  type AddSnippetArgs,
  type AddSnippetResult,
  addSnippet as addSnippetImpl,
} from "./add-snippet.ts";
import {
  type AddVariantArgs,
  type AddVariantResult,
  addVariant as addVariantImpl,
} from "./add-variant.ts";
import {
  type AddAnnotationArgs,
  type AnnotationResult,
  addAnnotation as addAnnotationImpl,
  type RemoveAnnotationArgs,
  removeAnnotation as removeAnnotationImpl,
  type UpdateAnnotationArgs,
  updateAnnotation as updateAnnotationImpl,
} from "./annotations.ts";
import { type ApplyClassesArgs, applyClasses as applyClassesImpl } from "./apply-classes.ts";
import {
  type ApplyClassesBulkArgs,
  applyClassesBulk as applyClassesBulkImpl,
} from "./apply-classes-bulk.ts";
import {
  type AddNoteArgs,
  addNote as addNoteImpl,
  type NoteResult,
  type RemoveNoteArgs,
  removeNote as removeNoteImpl,
  type UpdateNoteArgs,
  updateNote as updateNoteImpl,
} from "./canvas-notes.ts";
import type { MutationContext } from "./context.ts";
import { withPageLock, withSnippetLock } from "./context.ts";
import {
  type AuditSnippetArgs,
  auditSnippet as auditSnippetImpl,
  type DarkModeAuditArgs,
  type DarkModeAuditResult,
  darkModeAudit as darkModeAuditImpl,
} from "./dark-mode-audit.ts";
import type { MutationError } from "./errors.ts";
import { type InspectArgs, type InspectResult, inspect as inspectImpl } from "./inspect.ts";
import {
  type InstantiateSnippetArgs,
  type InstantiateSnippetResult,
  instantiateSnippet as instantiateSnippetImpl,
} from "./instantiate-snippet.ts";
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
  type RemoveSnippetArgs,
  type RemoveSnippetResult,
  removeSnippet as removeSnippetImpl,
} from "./remove-snippet.ts";
import {
  type RemoveVariantArgs,
  type RemoveVariantResult,
  removeVariant as removeVariantImpl,
} from "./remove-variant.ts";
import {
  type SetNodeIdArgs,
  type SetNodeIdResult,
  setNodeId as setNodeIdImpl,
} from "./set-node-id.ts";
import {
  type UpdatePageArgs,
  type UpdatePageResult,
  updatePage as updatePageImpl,
} from "./update-page.ts";
import {
  type UpdatePropsArgs,
  type UpdatePropsResult,
  updateProps as updatePropsImpl,
} from "./update-props.ts";
import {
  type UpdatePropsBulkArgs,
  type UpdatePropsBulkResult,
  updatePropsBulk as updatePropsBulkImpl,
} from "./update-props-bulk.ts";
import {
  type UpdateSnippetArgs,
  type UpdateSnippetResult,
  updateSnippet as updateSnippetImpl,
} from "./update-snippet.ts";
import {
  type UpdateSnippetArgsArgs,
  type UpdateSnippetArgsResult,
  updateSnippetArgs as updateSnippetArgsImpl,
} from "./update-snippet-args.ts";
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
export function updatePage(
  ctx: MutationContext,
  args: UpdatePageArgs,
): Promise<Result<UpdatePageResult, MutationError>> {
  return withPageLock(args.pageId, () => updatePageImpl(ctx, args));
}
export function applyClasses(
  ctx: MutationContext,
  args: ApplyClassesArgs,
): Promise<Result<UpdatePropsResult, MutationError>> {
  return withPageLock(args.pageId, () => applyClassesImpl(ctx, args));
}
export function applyClassesBulk(
  ctx: MutationContext,
  args: ApplyClassesBulkArgs,
): Promise<Result<UpdatePropsBulkResult, MutationError>> {
  return withPageLock(args.pageId, () => applyClassesBulkImpl(ctx, args));
}
export function updatePropsBulk(
  ctx: MutationContext,
  args: UpdatePropsBulkArgs,
): Promise<Result<UpdatePropsBulkResult, MutationError>> {
  return withPageLock(args.pageId, () => updatePropsBulkImpl(ctx, args));
}
export function setNodeId(
  ctx: MutationContext,
  args: SetNodeIdArgs,
): Promise<Result<SetNodeIdResult, MutationError>> {
  return withPageLock(args.pageId, () => setNodeIdImpl(ctx, args));
}
export function addAnnotation(
  ctx: MutationContext,
  args: AddAnnotationArgs,
): Promise<Result<AnnotationResult, MutationError>> {
  return withPageLock(args.pageId, () => addAnnotationImpl(ctx, args));
}
export function updateAnnotation(
  ctx: MutationContext,
  args: UpdateAnnotationArgs,
): Promise<Result<AnnotationResult, MutationError>> {
  return withPageLock(args.pageId, () => updateAnnotationImpl(ctx, args));
}
export function removeAnnotation(
  ctx: MutationContext,
  args: RemoveAnnotationArgs,
): Promise<Result<{ removedId: string }, MutationError>> {
  return withPageLock(args.pageId, () => removeAnnotationImpl(ctx, args));
}
export function addNote(
  ctx: MutationContext,
  args: AddNoteArgs,
): Promise<Result<NoteResult, MutationError>> {
  return withPageLock(args.pageId, () => addNoteImpl(ctx, args));
}
export function updateNote(
  ctx: MutationContext,
  args: UpdateNoteArgs,
): Promise<Result<NoteResult, MutationError>> {
  return withPageLock(args.pageId, () => updateNoteImpl(ctx, args));
}
export function removeNote(
  ctx: MutationContext,
  args: RemoveNoteArgs,
): Promise<Result<{ removedId: string }, MutationError>> {
  return withPageLock(args.pageId, () => removeNoteImpl(ctx, args));
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
export function addSnippet(
  ctx: MutationContext,
  args: AddSnippetArgs,
): Promise<Result<AddSnippetResult, MutationError>> {
  // Add is a single write; the in-memory map check + persist sits inside it.
  // Use a synthetic lock keyed on the resolved id once known — easier to just
  // serialize all snippet writes for now.
  return withSnippetLock(args.id ?? args.name, () => addSnippetImpl(ctx, args));
}
export function updateSnippet(
  ctx: MutationContext,
  args: UpdateSnippetArgs,
): Promise<Result<UpdateSnippetResult, MutationError>> {
  return withSnippetLock(args.snippetId, () => updateSnippetImpl(ctx, args));
}
export function removeSnippet(
  ctx: MutationContext,
  args: RemoveSnippetArgs,
): Promise<Result<RemoveSnippetResult, MutationError>> {
  return withSnippetLock(args.snippetId, () => removeSnippetImpl(ctx, args));
}
export function instantiateSnippet(
  ctx: MutationContext,
  args: InstantiateSnippetArgs,
): Promise<Result<InstantiateSnippetResult, MutationError>> {
  return withPageLock(args.pageId, () => instantiateSnippetImpl(ctx, args));
}
export function updateSnippetArgs(
  ctx: MutationContext,
  args: UpdateSnippetArgsArgs,
): Promise<Result<UpdateSnippetArgsResult, MutationError>> {
  return withPageLock(args.pageId, () => updateSnippetArgsImpl(ctx, args));
}

/** inspect is read-only; no mutex needed. */
export function inspect(
  ctx: MutationContext,
  args: InspectArgs,
): Promise<Result<InspectResult, MutationError>> {
  return inspectImpl(ctx, args);
}

/** Read-only dark-mode audit. */
export function darkModeAudit(
  ctx: MutationContext,
  args: DarkModeAuditArgs,
): Promise<Result<DarkModeAuditResult, MutationError>> {
  return darkModeAuditImpl(ctx, args);
}

/** Read-only dark-mode audit, scoped to a single snippet body. */
export function auditSnippet(
  ctx: MutationContext,
  args: AuditSnippetArgs,
): Promise<Result<DarkModeAuditResult, MutationError>> {
  return auditSnippetImpl(ctx, args);
}

export type { MutationError } from "./errors.ts";
export type {
  AddAnnotationArgs,
  AddNodeArgs,
  AddNodeResult,
  AddNoteArgs,
  AddPageArgs,
  AddPageResult,
  AddSnippetArgs,
  AddSnippetResult,
  AddVariantArgs,
  AddVariantResult,
  AnnotationResult,
  ApplyClassesArgs,
  ApplyClassesBulkArgs,
  AuditSnippetArgs,
  DarkModeAuditArgs,
  DarkModeAuditResult,
  InspectArgs,
  InspectResult,
  InstantiateSnippetArgs,
  InstantiateSnippetResult,
  MoveNodeArgs,
  MoveNodeResult,
  MutationContext,
  NoteResult,
  RemoveAnnotationArgs,
  RemoveNodeArgs,
  RemoveNodeResult,
  RemoveNoteArgs,
  RemovePageArgs,
  RemovePageResult,
  RemoveSnippetArgs,
  RemoveSnippetResult,
  RemoveVariantArgs,
  RemoveVariantResult,
  SetNodeIdArgs,
  SetNodeIdResult,
  UpdateAnnotationArgs,
  UpdateNoteArgs,
  UpdatePageArgs,
  UpdatePageResult,
  UpdatePropsArgs,
  UpdatePropsBulkArgs,
  UpdatePropsBulkResult,
  UpdatePropsResult,
  UpdateSnippetArgs,
  UpdateSnippetArgsArgs,
  UpdateSnippetArgsResult,
  UpdateSnippetResult,
  UpdateVariantArgs,
  UpdateVariantResult,
  UpdateVariantsArgs,
  UpdateVariantsResult,
};
