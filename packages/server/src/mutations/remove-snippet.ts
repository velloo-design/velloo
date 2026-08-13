import { $, DoAsync, err, type Result } from "@velloo/result";
import type { MutationContext } from "./context.ts";
import { type MutationError, snippetInUse } from "./errors.ts";
import { getSnippet } from "./lookup.ts";
import { deletePersistedSnippet } from "./persist.ts";
import { snippetIdsReferencedBy } from "./snippet-refs.ts";

export interface RemoveSnippetArgs {
  snippetId: string;
}

export interface RemoveSnippetResult {
  removedId: string;
}

/**
 * Remove a snippet. Refuses if any page still instantiates it; carries the
 * referencing pageIds so the agent can clean up first (via remove_node on
 * each instance) before retrying.
 */
export async function removeSnippet(
  ctx: MutationContext,
  args: RemoveSnippetArgs,
): Promise<Result<RemoveSnippetResult, MutationError>> {
  return DoAsync<RemoveSnippetResult, MutationError>(async function* () {
    yield* $(getSnippet(ctx, args.snippetId));

    const referencers: string[] = [];
    for (const [screenId, screen] of ctx.folder.screens) {
      if (snippetIdsReferencedBy(screen).has(args.snippetId)) referencers.push(screenId);
    }
    if (referencers.length > 0) {
      return yield* $(err(snippetInUse(args.snippetId, referencers)));
    }

    await deletePersistedSnippet(ctx.folder, args.snippetId);
    ctx.broadcast({ type: "snippet-changed", snippetId: args.snippetId });
    return { removedId: args.snippetId };
  });
}
