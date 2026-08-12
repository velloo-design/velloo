import { clonePage } from "./clone.ts";
import type { MutationContext } from "./context.ts";
import { MutationError } from "./errors.ts";
import { getPageOrThrow } from "./lookup.ts";
import { persistPage } from "./persist.ts";

export interface RemoveVariantArgs {
  pageId: string;
  variantId: string;
}

export interface RemoveVariantResult {
  removedVariantId: string;
}

/**
 * Drop a variant from a page. Refuses to remove the last variant — a page
 * must always have at least one renderable variant.
 */
export async function removeVariant(
  ctx: MutationContext,
  args: RemoveVariantArgs,
): Promise<RemoveVariantResult> {
  const page = getPageOrThrow(ctx, args.pageId);
  const idx = page.variants.findIndex((v) => v.id === args.variantId);
  if (idx === -1) {
    throw new MutationError({
      code: "VARIANT_NOT_FOUND",
      message: `Variant not found: ${JSON.stringify(args.variantId)}`,
    });
  }
  if (page.variants.length <= 1) {
    throw new MutationError({
      code: "INVALID_PATH",
      message: "A page must keep at least one variant. Delete the page instead.",
    });
  }

  const next = clonePage(page);
  next.variants.splice(idx, 1);

  await persistPage(ctx.folder, args.pageId, next);
  ctx.broadcast({ type: "page-changed", pageId: args.pageId });

  return { removedVariantId: args.variantId };
}
