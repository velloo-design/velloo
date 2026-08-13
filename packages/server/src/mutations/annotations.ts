import { randomUUID } from "node:crypto";
import { $, DoAsync, err, type Result } from "@velloo/result";
import type { Annotation, AnnotationTarget } from "@velloo/schema";
import { type Locator, resolveLocator } from "../path.ts";
import type { MutationContext } from "./context.ts";
import {
  annotationConflict,
  annotationNotFound,
  type MutationError,
  pageNotFound,
} from "./errors.ts";
import { getPage, getVariant, resolve as resolveVariantLocator } from "./lookup.ts";
import { persistAnnotations } from "./persist.ts";

/** Short id for annotations; 8-hex-char prefix of a UUID is plenty unique for per-page counts. */
function newAnnotationId(): string {
  return `ann_${randomUUID().replace(/-/g, "").slice(0, 8)}`;
}

export interface AddAnnotationArgs {
  pageId: string;
  target: AnnotationTarget;
  body: string;
  position?: { x: number; y: number } | "auto";
  collapsed?: boolean;
}

export interface AnnotationResult {
  annotation: Annotation;
}

/**
 * Compare two locators by resolving them against the same variant tree.
 * `"@hero-cta"` and `[1, 2]` are the same target if they point at the same
 * node. Returns false if either fails to resolve (we'd surface that as a
 * different error to the caller, not as "they're equal").
 */
function sameTarget(treeRoot: import("@velloo/schema").Node, a: Locator, b: Locator): boolean {
  const pa = resolveLocator(treeRoot, a);
  const pb = resolveLocator(treeRoot, b);
  if (!pa || !pb) return false;
  return JSON.stringify(pa) === JSON.stringify(pb);
}

export async function addAnnotation(
  ctx: MutationContext,
  args: AddAnnotationArgs,
): Promise<Result<AnnotationResult, MutationError>> {
  return DoAsync<AnnotationResult, MutationError>(async function* () {
    const page = yield* $(getPage(ctx, args.pageId));
    const variant = yield* $(getVariant(page, args.pageId, args.target.variantId));
    // Validate the locator now — better to surface IdNotFound at create time
    // than save a dangling annotation immediately.
    yield* $(
      resolveVariantLocator(variant.tree, args.target.locator, args.pageId, args.target.variantId),
    );

    // One annotation per (variant, node). Walk existing annotations on
    // this page; if any other annotation on the same variant resolves to
    // the same node, refuse.
    const existing = ctx.folder.annotations.get(args.pageId) ?? [];
    for (const a of existing) {
      if (a.target.variantId !== args.target.variantId) continue;
      if (sameTarget(variant.tree, a.target.locator, args.target.locator)) {
        return yield* $(
          err(annotationConflict(args.pageId, args.target.variantId, args.target.locator, a.id)),
        );
      }
    }

    const annotation: Annotation = {
      id: newAnnotationId(),
      target: args.target,
      position: args.position ?? "auto",
      body: args.body,
      ...(args.collapsed !== undefined ? { collapsed: args.collapsed } : {}),
    };
    const next = [...existing, annotation];
    await persistAnnotations(ctx.folder, args.pageId, next);
    ctx.broadcast({ type: "annotations-changed", pageId: args.pageId });
    return { annotation };
  });
}

export interface UpdateAnnotationArgs {
  pageId: string;
  annotationId: string;
  patch: {
    body?: string;
    position?: { x: number; y: number } | "auto";
    collapsed?: boolean | null;
  };
}

export async function updateAnnotation(
  ctx: MutationContext,
  args: UpdateAnnotationArgs,
): Promise<Result<AnnotationResult, MutationError>> {
  return DoAsync<AnnotationResult, MutationError>(async function* () {
    const existing = ctx.folder.annotations.get(args.pageId);
    if (!existing) return yield* $(err(pageNotFound(args.pageId)));
    const idx = existing.findIndex((a) => a.id === args.annotationId);
    if (idx === -1) {
      return yield* $(err(annotationNotFound(args.pageId, args.annotationId)));
    }
    const prev = existing[idx] as Annotation;
    const next: Annotation = {
      ...prev,
      ...(args.patch.body !== undefined ? { body: args.patch.body } : {}),
      ...(args.patch.position !== undefined ? { position: args.patch.position } : {}),
    };
    if (args.patch.collapsed === null) {
      delete (next as { collapsed?: boolean }).collapsed;
    } else if (args.patch.collapsed !== undefined) {
      next.collapsed = args.patch.collapsed;
    }
    const updated = [...existing];
    updated[idx] = next;
    await persistAnnotations(ctx.folder, args.pageId, updated);
    ctx.broadcast({ type: "annotations-changed", pageId: args.pageId });
    return { annotation: next };
  });
}

export interface RemoveAnnotationArgs {
  pageId: string;
  annotationId: string;
}

export async function removeAnnotation(
  ctx: MutationContext,
  args: RemoveAnnotationArgs,
): Promise<Result<{ removedId: string }, MutationError>> {
  return DoAsync<{ removedId: string }, MutationError>(async function* () {
    const existing = ctx.folder.annotations.get(args.pageId);
    if (!existing) return yield* $(err(pageNotFound(args.pageId)));
    if (!existing.some((a) => a.id === args.annotationId)) {
      return yield* $(err(annotationNotFound(args.pageId, args.annotationId)));
    }
    const next = existing.filter((a) => a.id !== args.annotationId);
    await persistAnnotations(ctx.folder, args.pageId, next);
    ctx.broadcast({ type: "annotations-changed", pageId: args.pageId });
    return { removedId: args.annotationId };
  });
}
