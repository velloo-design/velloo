import { pathAt } from "../path.ts";
import { clonePage } from "./clone.ts";
import type { MutationContext } from "./context.ts";
import { MutationError } from "./errors.ts";
import { getPageOrThrow, getVariantOrThrow } from "./lookup.ts";
import { persistPage } from "./persist.ts";

export interface UpdatePropsArgs {
  pageId: string;
  variantId: string;
  path: number[];
  /** Shallow patch. Keys with `null` values are removed. */
  propPatch: Record<string, unknown>;
}

export interface UpdatePropsResult {
  path: number[];
}

export async function updateProps(
  ctx: MutationContext,
  args: UpdatePropsArgs,
): Promise<UpdatePropsResult> {
  const { pageId, variantId, path, propPatch } = args;

  const page = getPageOrThrow(ctx, pageId);
  const variant = getVariantOrThrow(page, variantId);

  const next = clonePage(page);
  const nextVariant = next.variants.find((v) => v.id === variant.id);
  if (!nextVariant) throw new Error("invariant: variant lost on clone");

  const node = pathAt(nextVariant.tree, path);
  if (!node) {
    throw new MutationError({
      code: "INVALID_PATH",
      message: `No node at path ${JSON.stringify(path)}`,
      path,
    });
  }

  const merged: Record<string, unknown> = { ...(node.props ?? {}) };
  for (const [k, v] of Object.entries(propPatch)) {
    if (v === null) delete merged[k];
    else merged[k] = v;
  }
  if (Object.keys(merged).length === 0) {
    delete node.props;
  } else {
    node.props = merged;
  }

  await persistPage(ctx.folder, pageId, next);
  ctx.broadcast({ type: "page-changed", pageId });

  return { path };
}
