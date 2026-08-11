import type { Variant, VariantPosition, Viewport } from "@velloo/schema";
import { clonePage } from "./clone.ts";
import type { MutationContext } from "./context.ts";
import { MutationError } from "./errors.ts";
import { getPageOrThrow } from "./lookup.ts";
import { persistPage } from "./persist.ts";

export interface UpdateVariantArgs {
  pageId: string;
  variantId: string;
  /** Sparse patch — any subset of fields will be applied. */
  patch: {
    name?: string;
    viewport?: Viewport;
    /** Pass `null` to clear the position (back to auto-flow layout). */
    position?: VariantPosition | null;
  };
}

export interface UpdateVariantResult {
  variant: Variant;
}

/**
 * Update a variant's metadata: name, viewport, or canvas position. Does not
 * touch the tree (use update_props / move_node etc. for content edits).
 */
export async function updateVariant(
  ctx: MutationContext,
  args: UpdateVariantArgs,
): Promise<UpdateVariantResult> {
  const page = getPageOrThrow(ctx, args.pageId);
  const idx = page.variants.findIndex((v) => v.id === args.variantId);
  if (idx === -1) {
    throw new MutationError({
      code: "VARIANT_NOT_FOUND",
      message: `Variant not found: ${JSON.stringify(args.variantId)}`,
    });
  }

  const next = clonePage(page);
  const v = next.variants[idx] as Variant;

  if (args.patch.name !== undefined) v.name = args.patch.name;
  if (args.patch.viewport !== undefined) v.viewport = args.patch.viewport;
  if (args.patch.position !== undefined) {
    if (args.patch.position === null) {
      delete v.position;
    } else {
      v.position = args.patch.position;
    }
  }

  await persistPage(ctx.folder, args.pageId, next);
  ctx.broadcast({ type: "page-changed", pageId: args.pageId });
  return { variant: v };
}
