import { $, DoAsync, err, type Result } from "@velloo/result";
import { isComponentNode } from "@velloo/schema";
import { type Locator, parentOf, pathAt } from "../path.ts";
import { clonePage } from "./clone.ts";
import type { MutationContext } from "./context.ts";
import { invalidPath, type MutationError } from "./errors.ts";
import { getPage, getVariant, resolve } from "./lookup.ts";
import { commitPage } from "./persist.ts";

export interface RemoveNodeArgs {
  pageId: string;
  variantId: string;
  /** Locator — path array or `"@id"` string. */
  path: Locator;
}

export interface RemoveNodeResult {
  removedRef: string;
}

export async function removeNode(
  ctx: MutationContext,
  args: RemoveNodeArgs,
): Promise<Result<RemoveNodeResult, MutationError>> {
  const { pageId, variantId, path } = args;

  return DoAsync<RemoveNodeResult, MutationError>(async function* () {
    const page = yield* $(getPage(ctx, pageId));
    yield* $(getVariant(page, pageId, variantId));

    const next = clonePage(page);
    const nextVariant = next.variants.find((v) => v.id === variantId);
    if (!nextVariant) throw new Error("invariant: variant lost on clone");

    const resolved = yield* $(resolve(nextVariant.tree, path, pageId, variantId));
    if (resolved.length === 0) {
      return yield* $(err(invalidPath("Cannot remove the variant root.", resolved)));
    }

    const parentInfo = parentOf(resolved);
    if (!parentInfo) return yield* $(err(invalidPath("no parent", resolved)));
    const parent = pathAt(nextVariant.tree, parentInfo.parent);
    if (!parent || !isComponentNode(parent) || !parent.children) {
      return yield* $(err(invalidPath(`No node at path ${JSON.stringify(resolved)}`, resolved)));
    }
    if (parentInfo.index >= parent.children.length) {
      return yield* $(err(invalidPath(`No node at path ${JSON.stringify(resolved)}`, resolved)));
    }

    const [removed] = parent.children.splice(parentInfo.index, 1);
    if (parent.children.length === 0) delete parent.children;

    yield* $(await commitPage(ctx.folder, pageId, next));
    ctx.broadcast({ type: "page-changed", pageId });

    return { removedRef: describeRemoved(removed) };
  });
}

function describeRemoved(node: import("@velloo/schema").Node | undefined): string {
  if (!node) return "?";
  if (isComponentNode(node)) return node.$ref;
  if ("$snippet" in node) return `@${node.$snippet}`;
  return `$param:${(node as { $param: string }).$param}`;
}
