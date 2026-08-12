import { $, DoAsync, err, type Result } from "@velloo/result";
import { clonePage } from "./clone.ts";
import type { MutationContext } from "./context.ts";
import { lastVariant, type MutationError, variantNotFound } from "./errors.ts";
import { getPage } from "./lookup.ts";
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
): Promise<Result<RemoveVariantResult, MutationError>> {
  return DoAsync<RemoveVariantResult, MutationError>(async function* () {
    const page = yield* $(getPage(ctx, args.pageId));
    const idx = page.variants.findIndex((v) => v.id === args.variantId);
    if (idx === -1) return yield* $(err(variantNotFound(args.pageId, args.variantId)));
    if (page.variants.length <= 1) return yield* $(err(lastVariant(args.pageId)));

    const next = clonePage(page);
    next.variants.splice(idx, 1);

    await persistPage(ctx.folder, args.pageId, next);
    ctx.broadcast({ type: "page-changed", pageId: args.pageId });

    return { removedVariantId: args.variantId };
  });
}
