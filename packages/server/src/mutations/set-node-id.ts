import { $, DoAsync, type Result } from "@velloo/result";
import { isComponentNode, isSnippetInstance, NodeIdSchema } from "@velloo/schema";
import type { Locator } from "../path.ts";
import { clonePage } from "./clone.ts";
import type { MutationContext } from "./context.ts";
import { badRequest, invalidPath, type MutationError } from "./errors.ts";
import { getNode, getPage, getVariant, resolve } from "./lookup.ts";
import { commitPage } from "./persist.ts";

export interface SetNodeIdArgs {
  pageId: string;
  variantId: string;
  /** Locator for the node — path array or `"@id"` string. */
  path: Locator;
  /** New id. Pass `null` to clear the existing id. Format: /^[a-zA-Z][a-zA-Z0-9_-]*$/. */
  id: string | null;
}

export interface SetNodeIdResult {
  path: number[];
  /** The id after the mutation. null if cleared. */
  id: string | null;
}

/**
 * Set or clear a node's `$id` anchor. Used to retroactively name nodes
 * that were created without an id, or rename one. Per-variant uniqueness
 * is enforced at persist time; collisions surface as `IdConflict`.
 *
 * Targets `ComponentNode` and `SnippetInstance` — both support `$id`.
 * Param refs don't have ids; targeting one returns InvalidPath.
 */
export async function setNodeId(
  ctx: MutationContext,
  args: SetNodeIdArgs,
): Promise<Result<SetNodeIdResult, MutationError>> {
  if (args.id !== null) {
    const parsed = NodeIdSchema.safeParse(args.id);
    if (!parsed.success) {
      return {
        ok: false,
        error: badRequest(`Invalid node id ${JSON.stringify(args.id)}`, parsed.error.issues),
      };
    }
  }

  return DoAsync<SetNodeIdResult, MutationError>(async function* () {
    const page = yield* $(getPage(ctx, args.pageId));
    yield* $(getVariant(page, args.pageId, args.variantId));

    const next = clonePage(page);
    const nextVariant = next.variants.find((v) => v.id === args.variantId);
    if (!nextVariant) throw new Error("invariant: variant lost on clone");

    const resolved = yield* $(resolve(nextVariant.tree, args.path, args.pageId, args.variantId));
    const node = yield* $(getNode(nextVariant.tree, resolved, args.pageId, args.variantId));

    if (!isComponentNode(node) && !isSnippetInstance(node)) {
      return yield* $({
        ok: false,
        error: invalidPath(
          `Node at ${JSON.stringify(resolved)} cannot carry an id (param refs are anonymous).`,
          resolved,
        ),
      } as Result<never, MutationError>);
    }

    if (args.id === null) {
      delete (node as { $id?: string }).$id;
    } else {
      (node as { $id?: string }).$id = args.id;
    }

    yield* $(await commitPage(ctx.folder, args.pageId, next));
    ctx.broadcast({ type: "page-changed", pageId: args.pageId });
    return { path: resolved, id: args.id };
  });
}
