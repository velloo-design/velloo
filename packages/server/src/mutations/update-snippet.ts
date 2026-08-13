import { $, DoAsync, err, type Result } from "@velloo/result";
import type { Node, Snippet, SnippetParam } from "@velloo/schema";
import type { MutationContext } from "./context.ts";
import { type MutationError, snippetCycle } from "./errors.ts";
import { getSnippet } from "./lookup.ts";
import { persistSnippet } from "./persist.ts";
import { detectSnippetCycle } from "./snippet-cycle.ts";

export interface UpdateSnippetArgs {
  snippetId: string;
  /** Sparse patch — pass only the fields you want to change. */
  patch: {
    name?: string;
    params?: SnippetParam[];
    tree?: Node;
  };
}

export interface UpdateSnippetResult {
  snippet: Snippet;
}

/**
 * Update a snippet's metadata or body. Rejects updates that would create
 * a snippet cycle. Snippet id stays stable so existing instances keep
 * working through a rename.
 */
export async function updateSnippet(
  ctx: MutationContext,
  args: UpdateSnippetArgs,
): Promise<Result<UpdateSnippetResult, MutationError>> {
  return DoAsync<UpdateSnippetResult, MutationError>(async function* () {
    const prev = yield* $(getSnippet(ctx, args.snippetId));
    const next: Snippet = {
      ...prev,
      ...(args.patch.name !== undefined ? { name: args.patch.name } : {}),
      ...(args.patch.params !== undefined ? { params: args.patch.params } : {}),
      ...(args.patch.tree !== undefined ? { tree: args.patch.tree } : {}),
    };

    if (args.patch.tree !== undefined) {
      const registry = new Map(ctx.folder.snippets);
      registry.set(next.id, next);
      const cycle = detectSnippetCycle(next.tree, next.id, registry);
      if (cycle) return yield* $(err(snippetCycle(next.id, cycle)));
    }

    const persisted = await persistSnippet(ctx.folder, next.id, next);
    ctx.broadcast({ type: "snippet-changed", snippetId: next.id });
    return { snippet: persisted };
  });
}
