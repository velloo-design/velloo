import { parentOf, pathAt } from "../path.ts";
import { clonePage } from "./clone.ts";
import type { MutationContext } from "./context.ts";
import { MutationError } from "./errors.ts";
import { getPageOrThrow, getVariantOrThrow } from "./lookup.ts";
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
): Promise<RemoveNodeResult> {
  const { pageId, variantId, path } = args;

  if (path.length === 0) {
    throw new MutationError({
      code: "INVALID_PATH",
      message: "Cannot remove the variant root.",
      path,
    });
  }

  const page = getPageOrThrow(ctx, pageId);
  const variant = getVariantOrThrow(page, variantId);

  const next = clonePage(page);
  const nextVariant = next.variants.find((v) => v.id === variant.id);
  if (!nextVariant) throw new Error("invariant: variant lost on clone");

  const parentInfo = parentOf(path);
  if (!parentInfo) {
    throw new MutationError({ code: "INVALID_PATH", message: "no parent", path });
  }
  const parent = pathAt(nextVariant.tree, parentInfo.parent);
  if (!parent?.children || parentInfo.index >= parent.children.length) {
    throw new MutationError({
      code: "INVALID_PATH",
      message: `No node at path ${JSON.stringify(path)}`,
      path,
    });
  }

  const [removed] = parent.children.splice(parentInfo.index, 1);
  if (parent.children.length === 0) delete parent.children;

  await persistPage(ctx.folder, pageId, next);
  ctx.broadcast({ type: "page-changed", pageId });

  return { removedRef: removed?.$ref ?? "?" };
}
