import { $, DoAsync, err, type Result } from "@velloo/result";
import type { ComponentNode, Node } from "@velloo/schema";
import type { Locator } from "../path.ts";
import { clonePage } from "./clone.ts";
import type { MutationContext } from "./context.ts";
import { invalidPath, type MutationError } from "./errors.ts";
import { ensureKnownComponent, getComponentNode, getPage, getVariant, resolve } from "./lookup.ts";
import { commitPage } from "./persist.ts";

export interface AddNodeArgs {
  pageId: string;
  variantId: string;
  /** Locator for the parent under which to insert. Either a path or `"@id"`. */
  parentPath: Locator;
  componentRef: string;
  /** Optional stable id for the new node (addressable as `"@id"` later). */
  id?: string;
  props?: Record<string, unknown>;
  children?: Node[];
  /** Insert position; defaults to end of parent's children. */
  index?: number;
}

export interface AddNodeResult {
  /** Path of the newly inserted node. */
  path: number[];
}

export async function addNode(
  ctx: MutationContext,
  args: AddNodeArgs,
): Promise<Result<AddNodeResult, MutationError>> {
  const { pageId, variantId, parentPath, componentRef } = args;
  return DoAsync<AddNodeResult, MutationError>(async function* () {
    yield* $(ensureKnownComponent(componentRef));
    const page = yield* $(getPage(ctx, pageId));
    yield* $(getVariant(page, pageId, variantId));

    const next = clonePage(page);
    const nextVariant = next.variants.find((v) => v.id === variantId);
    if (!nextVariant) throw new Error("invariant: variant lost on clone");

    const resolvedParent = yield* $(resolve(nextVariant.tree, parentPath, pageId, variantId));
    const parent = yield* $(getComponentNode(nextVariant.tree, resolvedParent, pageId, variantId));
    if (!parent.children) parent.children = [];
    const idx = args.index ?? parent.children.length;
    if (idx < 0 || idx > parent.children.length) {
      return yield* $(
        err(
          invalidPath(
            `index ${idx} out of range for parent with ${parent.children.length} children`,
            resolvedParent,
          ),
        ),
      );
    }

    const newNode: ComponentNode = {
      $ref: componentRef,
      ...(args.id !== undefined ? { $id: args.id } : {}),
      ...(args.props ? { props: args.props } : {}),
      ...(args.children ? { children: args.children } : {}),
    };
    parent.children.splice(idx, 0, newNode);

    yield* $(await commitPage(ctx.folder, pageId, next));
    ctx.broadcast({ type: "page-changed", pageId });
    return { path: [...resolvedParent, idx] };
  });
}
