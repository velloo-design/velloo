import type { Node } from "@velloo/schema";
import { pathAt } from "../path.ts";
import { clonePage } from "./clone.ts";
import type { MutationContext } from "./context.ts";
import { MutationError } from "./errors.ts";
import { ensureKnownComponentOrThrow, getPageOrThrow, getVariantOrThrow } from "./lookup.ts";
import { persistPage } from "./persist.ts";

export interface AddNodeArgs {
  pageId: string;
  variantId: string;
  parentPath: number[];
  componentRef: string;
  props?: Record<string, unknown>;
  children?: Node[];
  /** Insert position; defaults to end of parent's children. */
  index?: number;
}

export interface AddNodeResult {
  /** Path of the newly inserted node. */
  path: number[];
}

export async function addNode(ctx: MutationContext, args: AddNodeArgs): Promise<AddNodeResult> {
  const { pageId, variantId, parentPath, componentRef } = args;
  ensureKnownComponentOrThrow(componentRef);

  const page = getPageOrThrow(ctx, pageId);
  const variant = getVariantOrThrow(page, variantId);

  const next = clonePage(page);
  const nextVariant = next.variants.find((v) => v.id === variant.id);
  if (!nextVariant) throw new Error("invariant: variant lost on clone");

  const parent = pathAt(nextVariant.tree, parentPath);
  if (!parent) {
    throw new MutationError({
      code: "INVALID_PATH",
      message: `No parent at ${JSON.stringify(parentPath)}`,
      path: parentPath,
    });
  }
  if (!parent.children) parent.children = [];
  const idx = args.index ?? parent.children.length;
  if (idx < 0 || idx > parent.children.length) {
    throw new MutationError({
      code: "INVALID_PATH",
      message: `index ${idx} out of range for parent with ${parent.children.length} children`,
      path: parentPath,
    });
  }

  const newNode: Node = {
    $ref: componentRef,
    ...(args.props ? { props: args.props } : {}),
    ...(args.children ? { children: args.children } : {}),
  };
  parent.children.splice(idx, 0, newNode);

  await persistPage(ctx.folder, pageId, next);
  ctx.broadcast({ type: "page-changed", pageId });

  return { path: [...parentPath, idx] };
}
