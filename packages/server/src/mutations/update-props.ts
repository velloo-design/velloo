import { $, DoAsync, type Result } from "@velloo/result";
import type { Locator } from "../path.ts";
import { clonePage } from "./clone.ts";
import type { MutationContext } from "./context.ts";
import type { MutationError } from "./errors.ts";
import { getComponentNode, getPage, getVariant, resolve } from "./lookup.ts";
import { commitPage } from "./persist.ts";

export interface UpdatePropsArgs {
  pageId: string;
  variantId: string;
  /** Locator for the target node. Either a path or `"@id"`. */
  path: Locator;
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

    const resolved = yield* $(resolve(nextVariant.tree, path, pageId, variantId));
    const node = yield* $(getComponentNode(nextVariant.tree, resolved, pageId, variantId));

    const merged: Record<string, unknown> = { ...(node.props ?? {}) };
    for (const [k, v] of Object.entries(propPatch)) {
      if (v === null) delete merged[k];
      else merged[k] = v;
    }
    if (Object.keys(merged).length === 0) delete node.props;
    else node.props = merged;

    yield* $(await commitPage(ctx.folder, pageId, next));
    ctx.broadcast({ type: "page-changed", pageId });
    return { path: resolved };
  });
}
