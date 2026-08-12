import { $, DoAsync, err, type Result } from "@velloo/result";
import type { Variant, VariantPosition, Viewport } from "@velloo/schema";
import { clonePage } from "./clone.ts";
import type { MutationContext } from "./context.ts";
import { type MutationError, variantNotFound } from "./errors.ts";
import { getPage } from "./lookup.ts";
import { persistPage } from "./persist.ts";

export interface UpdateVariantsArgs {
  pageId: string;
  /** Sparse patches keyed by variantId. Each patch follows update_variant's shape. */
  patches: Array<{
    variantId: string;
    patch: {
      name?: string;
      viewport?: Viewport;
      position?: VariantPosition | null;
    };
  }>;
}

export interface UpdateVariantsResult {
  variants: Variant[];
}

/**
 * Atomic bulk variant update — applies every patch in one persist + one
 * broadcast + one history entry. Used by drag-drop, which commits a position
 * for the dragged variant plus auto-flow positions for any siblings still
 * without an explicit position.
 */
export async function updateVariants(
  ctx: MutationContext,
  args: UpdateVariantsArgs,
): Promise<Result<UpdateVariantsResult, MutationError>> {
  return DoAsync<UpdateVariantsResult, MutationError>(async function* () {
    const page = yield* $(getPage(ctx, args.pageId));
    const next = clonePage(page);

    for (const { variantId, patch } of args.patches) {
      const idx = next.variants.findIndex((v) => v.id === variantId);
      if (idx === -1) return yield* $(err(variantNotFound(args.pageId, variantId)));
      const v = next.variants[idx] as Variant;
      if (patch.name !== undefined) v.name = patch.name;
      if (patch.viewport !== undefined) v.viewport = patch.viewport;
      if (patch.position !== undefined) {
        if (patch.position === null) delete v.position;
        else v.position = patch.position;
      }
    }

    await persistPage(ctx.folder, args.pageId, next);
    ctx.broadcast({ type: "page-changed", pageId: args.pageId });
    return { variants: next.variants };
  });
}
