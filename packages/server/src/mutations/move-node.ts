import { $, DoAsync, err, type Result } from "@velloo/result";
import { isComponentNode } from "@velloo/schema";
import { type Locator, parentOf, pathAt } from "../path.ts";
import { cloneScreen } from "./clone.ts";
import { broadcastTreeChange, type MutationContext } from "./context.ts";
import { invalidMove, invalidPath, type MutationError } from "./errors.ts";
import { getScreen, resolve } from "./lookup.ts";
import { commitScreen } from "./persist.ts";

export interface MoveNodeArgs {
  screenId: string;
  fromPath: Locator;
  toParent: Locator;
  toIndex?: number | undefined;
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
  const { screenId, fromPath, toParent } = args;

  return DoAsync<MoveNodeResult, MutationError>(async function* () {
    const screen = yield* $(getScreen(ctx, screenId));
    const next = cloneScreen(screen);

    const resolvedFrom = yield* $(resolve(next.tree, fromPath, screenId));
    const resolvedTo = yield* $(resolve(next.tree, toParent, screenId));

    if (resolvedFrom.length === 0) {
      return yield* $(err(invalidMove("Cannot move the screen root.")));
    }
    if (
      isAncestor(resolvedFrom, resolvedTo) ||
      JSON.stringify(resolvedFrom) === JSON.stringify(resolvedTo)
    ) {
      return yield* $(err(invalidMove("Cannot move a node into itself or its descendant.")));
    }

    const fromParentInfo = parentOf(resolvedFrom);
    if (!fromParentInfo) return yield* $(err(invalidPath("no parent", resolvedFrom)));
    const fromParent = pathAt(next.tree, fromParentInfo.parent);
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
    if (!moved) {
      return yield* $(err(invalidPath("internal: detach lost node during move", resolvedFrom)));
    }

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
      adjustedToParent = [...resolvedTo];
      adjustedToParent[fromParentInfo.parent.length] =
        (adjustedToParent[fromParentInfo.parent.length] as number) - 1;
    }

    const target = pathAt(next.tree, adjustedToParent);
    if (!target || !isComponentNode(target)) {
      return yield* $(
        err(invalidPath(`No parent at ${JSON.stringify(adjustedToParent)}`, adjustedToParent)),
      );
    }
    if (!target.children) target.children = [];
    toIdx = Math.min(toIdx, target.children.length);
    if (toIdx < 0) toIdx = 0;
    target.children.splice(toIdx, 0, moved);

    yield* $(await commitScreen(ctx.folder, screenId, next));
    broadcastTreeChange(ctx, screenId);
    return { newPath: [...adjustedToParent, toIdx] };
  });
}
