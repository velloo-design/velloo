import { $, DoAsync, err, type Result } from "@velloo/result";
import { parentOf, pathAt } from "../path.ts";
import { clonePage } from "./clone.ts";
import type { MutationContext } from "./context.ts";
import { invalidMove, invalidPath, type MutationError } from "./errors.ts";
import { getPage, getVariant } from "./lookup.ts";
import { persistPage } from "./persist.ts";

export interface MoveNodeArgs {
  pageId: string;
  variantId: string;
  fromPath: number[];
  /** Destination as a parent + insertion index. Equivalent to "insert before existing child at index". */
  toParent: number[];
  toIndex?: number;
}

export interface MoveNodeResult {
  newPath: number[];
}

function isAncestor(ancestor: number[], descendant: number[]): boolean {
  if (ancestor.length >= descendant.length) return false;
  return ancestor.every((seg, i) => descendant[i] === seg);
}

export async function moveNode(
  ctx: MutationContext,
  args: MoveNodeArgs,
): Promise<Result<MoveNodeResult, MutationError>> {
  const { pageId, variantId, fromPath, toParent } = args;

  if (fromPath.length === 0) {
    return err(invalidMove("Cannot move the variant root."));
  }
  if (isAncestor(fromPath, toParent) || JSON.stringify(fromPath) === JSON.stringify(toParent)) {
    return err(invalidMove("Cannot move a node into itself or its descendant."));
  }

  return DoAsync<MoveNodeResult, MutationError>(async function* () {
    const page = yield* $(getPage(ctx, pageId));
    yield* $(getVariant(page, pageId, variantId));

    const next = clonePage(page);
    const nextVariant = next.variants.find((v) => v.id === variantId);
    if (!nextVariant) throw new Error("invariant: variant lost on clone");

    // Detach.
    const fromParentInfo = parentOf(fromPath);
    if (!fromParentInfo) return yield* $(err(invalidPath("no parent", fromPath)));
    const fromParent = pathAt(nextVariant.tree, fromParentInfo.parent);
    if (!fromParent?.children || fromParentInfo.index >= fromParent.children.length) {
      return yield* $(err(invalidPath(`No node at path ${JSON.stringify(fromPath)}`, fromPath)));
    }
    const [moved] = fromParent.children.splice(fromParentInfo.index, 1);
    if (fromParent.children.length === 0) delete fromParent.children;
    if (!moved) throw new Error("invariant: detach lost node");

    // Adjust target parent path if it was affected by the splice.
    let adjustedToParent = toParent;
    const sameParent = JSON.stringify(fromParentInfo.parent) === JSON.stringify(toParent);
    let toIdx = args.toIndex ?? Infinity;

    if (sameParent && toIdx > fromParentInfo.index) {
      toIdx = Math.max(0, toIdx - 1);
    } else if (
      toParent.length > fromParentInfo.parent.length &&
      isAncestor(fromParentInfo.parent, toParent) &&
      (toParent[fromParentInfo.parent.length] ?? -1) > fromParentInfo.index
    ) {
      // The target parent path went through the from-parent and past the removed sibling.
      adjustedToParent = [...toParent];
      adjustedToParent[fromParentInfo.parent.length] =
        (adjustedToParent[fromParentInfo.parent.length] as number) - 1;
    }

    const target = pathAt(nextVariant.tree, adjustedToParent);
    if (!target) {
      return yield* $(
        err(invalidPath(`No parent at ${JSON.stringify(adjustedToParent)}`, adjustedToParent)),
      );
    }
    if (!target.children) target.children = [];
    toIdx = Math.min(toIdx, target.children.length);
    if (toIdx < 0) toIdx = 0;
    target.children.splice(toIdx, 0, moved);

    await persistPage(ctx.folder, pageId, next);
    ctx.broadcast({ type: "page-changed", pageId });

    return { newPath: [...adjustedToParent, toIdx] };
  });
}
