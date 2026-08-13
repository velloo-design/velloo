import { $, DoAsync, err, type Result } from "@velloo/result";
import { isSnippetInstance } from "@velloo/schema";
import type { Locator } from "../path.ts";
import { clonePage } from "./clone.ts";
import type { MutationContext } from "./context.ts";
import { invalidPath, type MutationError } from "./errors.ts";
import { getNode, getPage, getVariant, resolve } from "./lookup.ts";
import { commitPage } from "./persist.ts";

export interface UpdateSnippetArgsArgs {
  pageId: string;
  variantId: string;
  /** Locator to a $snippet instance — path array or `"@id"` string. */
  path: Locator;
  /** Shallow patch over the instance's `args` map. `null` removes a key. */
  argPatch: Record<string, unknown>;
  /**
   * Replace the instance's extraClassName. Pass `null` to clear, omit to
   * leave unchanged. Used for one-off styling tweaks on otherwise opaque
   * snippet instances (e.g. wider featured pricing tier).
   */
  extraClassName?: string | null;
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

    const resolved = yield* $(resolve(nextVariant.tree, args.path, args.pageId, args.variantId));
    const node = yield* $(getNode(nextVariant.tree, resolved, args.pageId, args.variantId));
    if (!isSnippetInstance(node)) {
      return yield* $(
        err(
          invalidPath(`Node at ${JSON.stringify(resolved)} is not a snippet instance.`, resolved),
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

    if (args.extraClassName !== undefined) {
      if (args.extraClassName === null || args.extraClassName.trim() === "") {
        delete node.$extraClassName;
      } else {
        node.$extraClassName = args.extraClassName.trim();
      }
    }

    yield* $(await commitPage(ctx.folder, args.pageId, next));
    ctx.broadcast({ type: "page-changed", pageId: args.pageId });
    return { path: resolved };
  });
}
