import { $, DoAsync, err, type Result } from "@velloo/result";
import { isComponentNode } from "@velloo/schema";
import { type Locator, parentOf, pathAt } from "../path.ts";
import { clonePage } from "./clone.ts";
import type { MutationContext } from "./context.ts";
import { invalidMove, invalidPath, type MutationError } from "./errors.ts";
import { getPage, getVariant, resolve } from "./lookup.ts";
import { commitPage } from "./persist.ts";

export interface MoveNodeArgs {
  pageId: string;
  variantId: string;
  /** Locator for the node to move — path array or `"@id"` string. */
  fromPath: Locator;
  /** Locator for the destination parent. Equivalent to "insert before existing child at toIndex". */
  toParent: Locator;
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

  return DoAsync<MoveNodeResult, MutationError>(async function* () {
    const page = yield* $(getPage(ctx, pageId));
    yield* $(getVariant(page, pageId, variantId));

    const next = clonePage(page);
    const nextVariant = next.variants.find((v) => v.id === variantId);
    if (!nextVariant) throw new Error("invariant: variant lost on clone");

    // Resolve locators against the cloned tree (so @id resolution stays
    // consistent with the in-flight mutation, not the cached page).
    const resolvedFrom = yield* $(resolve(nextVariant.tree, fromPath, pageId, variantId));
    const resolvedTo = yield* $(resolve(nextVariant.tree, toParent, pageId, variantId));

    if (resolvedFrom.length === 0) {
      return yield* $(err(invalidMove("Cannot move the variant root.")));
    }
    if (
      isAncestor(resolvedFrom, resolvedTo) ||
      JSON.stringify(resolvedFrom) === JSON.stringify(resolvedTo)
    ) {
      return yield* $(err(invalidMove("Cannot move a node into itself or its descendant.")));
    }

    // Detach.
    const fromParentInfo = parentOf(resolvedFrom);
    if (!fromParentInfo) return yield* $(err(invalidPath("no parent", resolvedFrom)));
    const fromParent = pathAt(nextVariant.tree, fromParentInfo.parent);
    if (!fromParent || !isComponentNode(fromParent) || !fromParent.children) {
      return yield* $(
        err(invalidPath(`No node at path ${JSON.stringify(resolvedFrom)}`, resolvedFrom)),
      );
    }
    if (fromParentInfo.index >= fromParent.children.length) {
      return yield* $(
        err(invalidPath(`No node at path ${JSON.stringify(resolvedFrom)}`, resolvedFrom)),
      );
    }
    const [moved] = fromParent.children.splice(fromParentInfo.index, 1);
    if (fromParent.children.length === 0) delete fromParent.children;
    if (!moved) throw new Error("invariant: detach lost node");

    // Adjust target parent path if it was affected by the splice.
    let adjustedToParent = resolvedTo;
    const sameParent = JSON.stringify(fromParentInfo.parent) === JSON.stringify(resolvedTo);
    let toIdx = args.toIndex ?? Infinity;

    if (sameParent && toIdx > fromParentInfo.index) {
      toIdx = Math.max(0, toIdx - 1);
    } else if (
      resolvedTo.length > fromParentInfo.parent.length &&
      isAncestor(fromParentInfo.parent, resolvedTo) &&
      (resolvedTo[fromParentInfo.parent.length] ?? -1) > fromParentInfo.index
    ) {
      // The target parent path went through the from-parent and past the removed sibling.
      adjustedToParent = [...resolvedTo];
      adjustedToParent[fromParentInfo.parent.length] =
        (adjustedToParent[fromParentInfo.parent.length] as number) - 1;
    }

    const target = pathAt(nextVariant.tree, adjustedToParent);
    if (!target || !isComponentNode(target)) {
      return yield* $(
        err(invalidPath(`No parent at ${JSON.stringify(adjustedToParent)}`, adjustedToParent)),
      );
    }
    if (!target.children) target.children = [];
    toIdx = Math.min(toIdx, target.children.length);
    if (toIdx < 0) toIdx = 0;
    target.children.splice(toIdx, 0, moved);

    yield* $(await commitPage(ctx.folder, pageId, next));
    ctx.broadcast({ type: "page-changed", pageId });

    return { newPath: [...adjustedToParent, toIdx] };
  });
}
