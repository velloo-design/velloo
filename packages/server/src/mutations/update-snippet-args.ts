import { $, DoAsync, err, type Result } from "@velloo/result";
import { isSnippetInstance } from "@velloo/schema";
import { clonePage } from "./clone.ts";
import type { MutationContext } from "./context.ts";
import { invalidPath, type MutationError } from "./errors.ts";
import { getNode, getPage, getVariant } from "./lookup.ts";
import { persistPage } from "./persist.ts";

export interface UpdateSnippetArgsArgs {
  pageId: string;
  variantId: string;
  /** Path to a $snippet instance in the variant tree. */
  path: number[];
  /** Shallow patch over the instance's `args` map. `null` removes a key. */
  argPatch: Record<string, unknown>;
}

export interface UpdateSnippetArgsResult {
  path: number[];
}

/**
 * Edit a snippet *instance*'s args without touching the snippet body. The
 * targeted node must be a `$snippet` instance — for editing the snippet
 * body itself, use `update_snippet`.
 */
export async function updateSnippetArgs(
  ctx: MutationContext,
  args: UpdateSnippetArgsArgs,
): Promise<Result<UpdateSnippetArgsResult, MutationError>> {
  return DoAsync<UpdateSnippetArgsResult, MutationError>(async function* () {
    const page = yield* $(getPage(ctx, args.pageId));
    yield* $(getVariant(page, args.pageId, args.variantId));

    const next = clonePage(page);
    const nextVariant = next.variants.find((v) => v.id === args.variantId);
    if (!nextVariant) throw new Error("invariant: variant lost on clone");

    const node = yield* $(getNode(nextVariant.tree, args.path));
    if (!isSnippetInstance(node)) {
      return yield* $(
        err(
          invalidPath(`Node at ${JSON.stringify(args.path)} is not a snippet instance.`, args.path),
        ),
      );
    }

    const merged: Record<string, unknown> = { ...(node.args ?? {}) };
    for (const [k, v] of Object.entries(args.argPatch)) {
      if (v === null) delete merged[k];
      else merged[k] = v;
    }
    if (Object.keys(merged).length === 0) delete node.args;
    else node.args = merged;

    await persistPage(ctx.folder, args.pageId, next);
    ctx.broadcast({ type: "page-changed", pageId: args.pageId });
    return { path: args.path };
  });
}
