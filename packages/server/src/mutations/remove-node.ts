import { $, DoAsync, err, ok, type Result } from "@velloo/result";
import { parentOf, pathAt } from "../path.ts";
import { clonePage } from "./clone.ts";
import type { MutationContext } from "./context.ts";
import { invalidPath, type MutationError } from "./errors.ts";
import { getPage, getVariant } from "./lookup.ts";
import { persistPage } from "./persist.ts";

export interface RemoveNodeArgs {
  pageId: string;
  variantId: string;
  path: number[];
}

export interface RemoveNodeResult {
  removedRef: string;
}

export async function removeNode(
  ctx: MutationContext,
  args: RemoveNodeArgs,
): Promise<Result<RemoveNodeResult, MutationError>> {
  const { pageId, variantId, path } = args;

  if (path.length === 0) {
    return err(invalidPath("Cannot remove the variant root.", path));
  }

  return DoAsync<RemoveNodeResult, MutationError>(async function* () {
    const page = yield* $(getPage(ctx, pageId));
    yield* $(getVariant(page, pageId, variantId));

    const next = clonePage(page);
    const nextVariant = next.variants.find((v) => v.id === variantId);
    if (!nextVariant) throw new Error("invariant: variant lost on clone");

    const parentInfo = parentOf(path);
    if (!parentInfo) return yield* $(err(invalidPath("no parent", path)));
    const parent = pathAt(nextVariant.tree, parentInfo.parent);
    if (!parent?.children || parentInfo.index >= parent.children.length) {
      return yield* $(err(invalidPath(`No node at path ${JSON.stringify(path)}`, path)));
    }

    const [removed] = parent.children.splice(parentInfo.index, 1);
    if (parent.children.length === 0) delete parent.children;

    await persistPage(ctx.folder, pageId, next);
    ctx.broadcast({ type: "page-changed", pageId });

    return { removedRef: removed?.$ref ?? "?" };
  });
}
