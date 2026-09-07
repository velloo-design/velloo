import { randomUUID } from "node:crypto";
import { $, DoAsync, err, type Result } from "@velloo/result";
import type { Annotation, AnnotationTarget } from "@velloo/schema";
import { type Locator, resolveLocator } from "../path.ts";
import type { MutationContext } from "./context.ts";
import {
  annotationConflict,
  annotationNotFound,
  type MutationError,
  screenNotFound,
} from "./errors.ts";
import { getScreen, resolve as resolveScreenLocator } from "./lookup.ts";
import { persistAnnotations } from "./persist.ts";

function newAnnotationId(): string {
  return `ann_${randomUUID().replace(/-/g, "").slice(0, 8)}`;
}

export interface AddAnnotationArgs {
  screenId: string;
  target: AnnotationTarget;
  body: string;
  position?: { x: number; y: number } | "auto" | undefined;
  collapsed?: boolean | undefined;
  /** Authorship marker — the MCP layer forces "agent"; defaults to "user". */
  author?: "user" | "agent" | undefined;
}

export interface AnnotationResult {
  annotation: Annotation;
}

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
    const screen = yield* $(getScreen(ctx, args.screenId));
    yield* $(resolveScreenLocator(screen.tree, args.target.locator, args.screenId));

    const existing = ctx.folder.annotations.get(args.screenId) ?? [];
    for (const a of existing) {
      if (sameTarget(screen.tree, a.target.locator, args.target.locator)) {
        return yield* $(err(annotationConflict(args.screenId, args.target.locator, a.id)));
      }
    }

    const annotation: Annotation = {
      id: newAnnotationId(),
      target: args.target,
      position: args.position ?? "auto",
      body: args.body,
      ...(args.collapsed !== undefined ? { collapsed: args.collapsed } : {}),
      author: args.author ?? "user",
    };
    const next = [...existing, annotation];
    await persistAnnotations(ctx.folder, args.screenId, next);
    ctx.broadcast({ type: "annotations-changed", screenId: args.screenId });
    return { annotation };
  });
}

export interface UpdateAnnotationArgs {
  screenId: string;
  annotationId: string;
  patch: {
    body?: string | undefined;
    position?: { x: number; y: number } | "auto" | undefined;
    collapsed?: boolean | null | undefined;
  };
}

export async function updateAnnotation(
  ctx: MutationContext,
  args: UpdateAnnotationArgs,
): Promise<Result<AnnotationResult, MutationError>> {
  return DoAsync<AnnotationResult, MutationError>(async function* () {
    // A missing sidecar on an existing screen means "no such annotation",
    // not "no such screen".
    const existing = ctx.folder.annotations.get(args.screenId);
    if (!existing) {
      return yield* $(
        err(
          ctx.folder.screens.has(args.screenId)
            ? annotationNotFound(args.screenId, args.annotationId)
            : screenNotFound(args.screenId),
        ),
      );
    }
    const idx = existing.findIndex((a) => a.id === args.annotationId);
    if (idx === -1) {
      return yield* $(err(annotationNotFound(args.screenId, args.annotationId)));
    }
    const prev = existing[idx] as Annotation;
    const next: Annotation = {
      ...prev,
      ...(args.patch.body !== undefined ? { body: args.patch.body } : {}),
      ...(args.patch.position !== undefined ? { position: args.patch.position } : {}),
    };
    if (args.patch.collapsed === null) {
      delete (next as { collapsed?: boolean | undefined }).collapsed;
    } else if (args.patch.collapsed !== undefined) {
      next.collapsed = args.patch.collapsed;
    }
    const updated = [...existing];
    updated[idx] = next;
    await persistAnnotations(ctx.folder, args.screenId, updated);
    ctx.broadcast({ type: "annotations-changed", screenId: args.screenId });
    return { annotation: next };
  });
}

export interface RemoveAnnotationArgs {
  screenId: string;
  annotationId: string;
}

export async function removeAnnotation(
  ctx: MutationContext,
  args: RemoveAnnotationArgs,
): Promise<Result<{ removedId: string }, MutationError>> {
  return DoAsync<{ removedId: string }, MutationError>(async function* () {
    const existing = ctx.folder.annotations.get(args.screenId);
    if (!existing) {
      return yield* $(
        err(
          ctx.folder.screens.has(args.screenId)
            ? annotationNotFound(args.screenId, args.annotationId)
            : screenNotFound(args.screenId),
        ),
      );
    }
    if (!existing.some((a) => a.id === args.annotationId)) {
      return yield* $(err(annotationNotFound(args.screenId, args.annotationId)));
    }
    const next = existing.filter((a) => a.id !== args.annotationId);
    await persistAnnotations(ctx.folder, args.screenId, next);
    ctx.broadcast({ type: "annotations-changed", screenId: args.screenId });
    return { removedId: args.annotationId };
  });
}
