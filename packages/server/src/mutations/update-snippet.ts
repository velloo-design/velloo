import { $, DoAsync, err, type Result } from "@velloo/result";
import { applySnippetOverrides, type Node, type Snippet, type SnippetParam } from "@velloo/schema";
import { resolveComponentRefs } from "./component-refs.ts";
import type { MutationContext } from "./context.ts";
import { invalidPath, type MutationError, snippetCycle } from "./errors.ts";
import { innerPathResolves } from "./inner-path.ts";
import { getSnippet } from "./lookup.ts";
import { persistSnippet } from "./persist.ts";
import { detectSnippetCycle } from "./snippet-cycle.ts";

export interface UpdateSnippetArgs {
  snippetId: string;
  /** Sparse patch — pass only the fields you want to change. */
  patch: {
    name?: string | undefined;
    params?: SnippetParam[] | undefined;
    tree?: Node | undefined;
    /**
     * Patch the props of one node *inside* the snippet body without
     * resending the whole tree — the definition-level counterpart of
     * `override_snippet_props`. The change is shared by every instance.
     * `innerPath`: "@id" of a body node (preferred), a dotted index path
     * ("0.2"), or "" for the body root. `null` values in `propPatch` remove
     * keys. Applied on top of `tree` when both are present.
     */
    innerPatch?: { innerPath: string; propPatch: Record<string, unknown> } | undefined;
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
    const { innerPatch } = args.patch;

    // The body the patch operates on: a full replacement if given, else the
    // existing one. `innerPatch` then patches a single node inside it.
    let tree = args.patch.tree ?? prev.tree;
    if (innerPatch !== undefined) {
      if (!/^$|^\d+(\.\d+)*$|^@[a-zA-Z][a-zA-Z0-9_-]*$/.test(innerPatch.innerPath)) {
        return yield* $(
          err(
            invalidPath(
              `innerPath must be a dotted index path like "0.2", an "@id" of a body node, or "" for the root`,
            ),
          ),
        );
      }
      if (!innerPathResolves(tree, innerPatch.innerPath)) {
        return yield* $(
          err(
            invalidPath(
              `innerPath "${innerPatch.innerPath}" doesn't resolve to a component inside snippet "${args.snippetId}"`,
            ),
          ),
        );
      }
      tree = applySnippetOverrides(tree, {
        [innerPatch.innerPath]: { props: innerPatch.propPatch },
      });
    }

    const treeChanged = args.patch.tree !== undefined || innerPatch !== undefined;
    if (treeChanged) tree = yield* $(await resolveComponentRefs(ctx, tree, prev));
    const params =
      args.patch.params === undefined
        ? undefined
        : yield* $(await resolveComponentRefs(ctx, args.patch.params, prev));
    const next: Snippet = {
      ...prev,
      ...(args.patch.name !== undefined ? { name: args.patch.name } : {}),
      ...(params !== undefined ? { params } : {}),
      ...(treeChanged ? { tree } : {}),
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
