import { $, DoAsync, err, type Result } from "@velloo/result";
import type { MutationContext } from "./context.ts";
import { type MutationError, snippetInUse } from "./errors.ts";
import { getSnippet } from "./lookup.ts";
import { deletePersistedSnippet } from "./persist.ts";
import { snippetReferencers } from "./snippet-refs.ts";

export interface RemoveSnippetArgs {
  snippetId: string;
}

export interface RemoveSnippetResult {
  removedId: string;
}

/**
 * Remove a snippet. Refuses while anything still instantiates it, and carries
 * the referencing ids so the agent can clean up first — `remove_node` for an
 * instance in a screen, `update_snippet` for one in a snippet body.
 *
 * Snippet bodies count. The guard used to walk screens only, so a snippet
 * that only *another snippet* embedded deleted cleanly and left that body
 * pointing at nothing — the parent broke, and only at its next render.
 */
export async function removeSnippet(
  ctx: MutationContext,
  args: RemoveSnippetArgs,
): Promise<Result<RemoveSnippetResult, MutationError>> {
  return DoAsync<RemoveSnippetResult, MutationError>(async function* () {
    yield* $(getSnippet(ctx, args.snippetId));

    const { screenIds, snippetIds } = snippetReferencers(ctx.folder, args.snippetId);
    if (screenIds.length > 0 || snippetIds.length > 0) {
      return yield* $(err(snippetInUse(args.snippetId, screenIds, snippetIds)));
    }

    await deletePersistedSnippet(ctx.folder, args.snippetId);
    ctx.broadcast({ type: "snippet-changed", snippetId: args.snippetId });
    return { removedId: args.snippetId };
  });
}
