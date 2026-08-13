import { $, DoAsync, type Result } from "@velloo/result";
import type { Locator } from "../path.ts";
import { clonePage } from "./clone.ts";
import type { MutationContext } from "./context.ts";
import type { MutationError } from "./errors.ts";
import { getComponentNode, getPage, getVariant, resolve } from "./lookup.ts";
import { commitPage } from "./persist.ts";

export interface UpdatePropsBulkArgs {
  pageId: string;
  variantId: string;
  patches: Array<{
    /** Locator — path array or `"@id"` string. */
    path: Locator;
    /** Shallow patch. Keys with `null` values are removed. */
    propPatch: Record<string, unknown>;
  }>;
}

export interface UpdatePropsBulkResult {
  /** Resolved paths for each patch, in input order. */
  paths: number[][];
}

/**
 * Atomic bulk variant for `update_props`. Applies every patch against the
 * same cloned page, validates the result once, persists once, broadcasts
 * once, pushes one history entry. Use this when restyling many nodes at
 * once so undo reverts the whole batch instead of dozens of single edits.
 */
export async function updatePropsBulk(
  ctx: MutationContext,
  args: UpdatePropsBulkArgs,
): Promise<Result<UpdatePropsBulkResult, MutationError>> {
  return DoAsync<UpdatePropsBulkResult, MutationError>(async function* () {
    const page = yield* $(getPage(ctx, args.pageId));
    yield* $(getVariant(page, args.pageId, args.variantId));

    const next = clonePage(page);
    const nextVariant = next.variants.find((v) => v.id === args.variantId);
    if (!nextVariant) throw new Error("invariant: variant lost on clone");

    const resolvedPaths: number[][] = [];
    for (const { path, propPatch } of args.patches) {
      const resolved = yield* $(resolve(nextVariant.tree, path, args.pageId, args.variantId));
      const node = yield* $(
        getComponentNode(nextVariant.tree, resolved, args.pageId, args.variantId),
      );
      const merged: Record<string, unknown> = { ...(node.props ?? {}) };
      for (const [k, v] of Object.entries(propPatch)) {
        if (v === null) delete merged[k];
        else merged[k] = v;
      }
      if (Object.keys(merged).length === 0) delete node.props;
      else node.props = merged;
      resolvedPaths.push(resolved);
    }

    yield* $(await commitPage(ctx.folder, args.pageId, next));
    ctx.broadcast({ type: "page-changed", pageId: args.pageId });
    return { paths: resolvedPaths };
  });
}
