import { $, DoAsync, err, type Result } from "@velloo/result";
import { isComponentNode } from "@velloo/schema";
import { type Locator, parentOf, pathAt } from "../path.ts";
import { cloneScreen } from "./clone.ts";
import type { MutationContext } from "./context.ts";
import { invalidPath, type MutationError } from "./errors.ts";
import { getScreen, resolve } from "./lookup.ts";
import { commitScreen } from "./persist.ts";

export interface RemoveNodeArgs {
  screenId: string;
  path: Locator;
}

export interface RemoveNodeResult {
  removedRef: string;
}

export async function removeNode(
  ctx: MutationContext,
  args: RemoveNodeArgs,
): Promise<Result<RemoveNodeResult, MutationError>> {
  const { screenId, path } = args;
  return DoAsync<RemoveNodeResult, MutationError>(async function* () {
    const screen = yield* $(getScreen(ctx, screenId));
    const next = cloneScreen(screen);

    const resolved = yield* $(resolve(next.tree, path, screenId));
    if (resolved.length === 0) {
      return yield* $(err(invalidPath("Cannot remove the screen root.", resolved)));
    }

    const parentInfo = parentOf(resolved);
    if (!parentInfo) return yield* $(err(invalidPath("no parent", resolved)));
    const parent = pathAt(next.tree, parentInfo.parent);
    if (!parent || !isComponentNode(parent) || !parent.children) {
      return yield* $(err(invalidPath(`No node at path ${JSON.stringify(resolved)}`, resolved)));
    }
    if (parentInfo.index >= parent.children.length) {
      return yield* $(err(invalidPath(`No node at path ${JSON.stringify(resolved)}`, resolved)));
    }

    const [removed] = parent.children.splice(parentInfo.index, 1);
    if (parent.children.length === 0) delete parent.children;

    yield* $(await commitScreen(ctx.folder, screenId, next));
    ctx.broadcast({ type: "screen-changed", screenId });
    return { removedRef: describeRemoved(removed) };
  });
}

function describeRemoved(node: import("@velloo/schema").Node | undefined): string {
  if (!node) return "?";
  if (isComponentNode(node)) return node.$ref;
  if ("$snippet" in node) return `@${node.$snippet}`;
  return `$param:${(node as { $param: string }).$param}`;
}
