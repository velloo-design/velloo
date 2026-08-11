import type { Variant } from "@velloo/schema";
import { clonePage, cloneVariant } from "./clone.ts";
import type { MutationContext } from "./context.ts";
import { MutationError } from "./errors.ts";
import { getPageOrThrow } from "./lookup.ts";
import { persistPage } from "./persist.ts";

export interface AddVariantArgs {
  pageId: string;
  /** If provided, deep-copy the named variant's tree. Otherwise start with a bare Card. */
  fromVariantId?: string;
  viewport: { w: number; h: number };
  name: string;
  /** Variant id; auto-derived from name (slug) when omitted. */
  id?: string;
}

export interface AddVariantResult {
  variant: Variant;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

export async function addVariant(
  ctx: MutationContext,
  args: AddVariantArgs,
): Promise<AddVariantResult> {
  const page = getPageOrThrow(ctx, args.pageId);
  const next = clonePage(page);

  const id = args.id ?? (slugify(args.name) || `variant-${next.variants.length + 1}`);
  if (next.variants.some((v) => v.id === id)) {
    throw new MutationError({
      code: "INVALID_PATH",
      message: `Variant id already exists: ${JSON.stringify(id)}`,
    });
  }

  let tree: Variant["tree"];
  if (args.fromVariantId) {
    const src = next.variants.find((v) => v.id === args.fromVariantId);
    if (!src) {
      throw new MutationError({
        code: "VARIANT_NOT_FOUND",
        message: `fromVariantId not found: ${JSON.stringify(args.fromVariantId)}`,
      });
    }
    tree = cloneVariant(src).tree;
  } else {
    tree = { $ref: "Card", props: { className: "p-6" } };
  }

  const variant: Variant = {
    id,
    name: args.name,
    viewport: args.viewport,
    tree,
  };
  next.variants.push(variant);

  await persistPage(ctx.folder, args.pageId, next);
  ctx.broadcast({ type: "page-changed", pageId: args.pageId });

  return { variant };
}
