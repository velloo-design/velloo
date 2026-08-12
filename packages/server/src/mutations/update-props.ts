import { $, DoAsync, type Result } from "@velloo/result";
import { clonePage } from "./clone.ts";
import type { MutationContext } from "./context.ts";
import type { MutationError } from "./errors.ts";
import { getNode, getPage, getVariant } from "./lookup.ts";
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
): Promise<Result<UpdatePropsResult, MutationError>> {
  const { pageId, variantId, path, propPatch } = args;
  return DoAsync<UpdatePropsResult, MutationError>(async function* () {
    const page = yield* $(getPage(ctx, pageId));
    yield* $(getVariant(page, pageId, variantId));

    const next = clonePage(page);
    const nextVariant = next.variants.find((v) => v.id === variantId);
    if (!nextVariant) throw new Error("invariant: variant lost on clone");

    const node = yield* $(getNode(nextVariant.tree, path));

    const merged: Record<string, unknown> = { ...(node.props ?? {}) };
    for (const [k, v] of Object.entries(propPatch)) {
      if (v === null) delete merged[k];
      else merged[k] = v;
    }
    if (Object.keys(merged).length === 0) delete node.props;
    else node.props = merged;

    await persistPage(ctx.folder, pageId, next);
    ctx.broadcast({ type: "page-changed", pageId });
    return { path };
  });
}
