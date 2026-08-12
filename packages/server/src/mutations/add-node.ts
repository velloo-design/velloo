import { $, DoAsync, err, type Result } from "@velloo/result";
import type { Node } from "@velloo/schema";
import { clonePage } from "./clone.ts";
import type { MutationContext } from "./context.ts";
import { invalidPath, type MutationError } from "./errors.ts";
import { ensureKnownComponent, getNode, getPage, getVariant } from "./lookup.ts";
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

    const parent = yield* $(getNode(nextVariant.tree, parentPath));
    if (!parent.children) parent.children = [];
    const idx = args.index ?? parent.children.length;
    if (idx < 0 || idx > parent.children.length) {
      return yield* $(
        err(
          invalidPath(
            `index ${idx} out of range for parent with ${parent.children.length} children`,
            parentPath,
          ),
        ),
      );
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
  });
}
