import { err, ok, type Result } from "@velloo/result";
import type { Node, Snippet, SnippetParam } from "@velloo/schema";
import type { MutationContext } from "./context.ts";
import { type MutationError, snippetCycle, snippetIdConflict } from "./errors.ts";
import { persistSnippet } from "./persist.ts";
import { slugify } from "./slugify.ts";
import { detectSnippetCycle } from "./snippet-cycle.ts";

export interface AddSnippetArgs {
  /** Display name. Id is slug(name) unless `id` provided. */
  name: string;
  id?: string;
  /**
   * Declared params. Optional + defaulted here (not just via the standalone
   * tool's Zod `.default([])`) so the `batch` path — which dispatches raw args
   * and bypasses Zod defaults — accepts a params-less `add_snippet` too.
   */
  params?: SnippetParam[];
  tree: Node;
}

export interface AddSnippetResult {
  snippetId: string;
  snippet: Snippet;
}

/**
 * Create a new snippet. The id is derived from the name (slug) unless the
 * caller supplies one; uniqueness is enforced — `id` collisions return
 * SnippetIdConflict so the agent can pick a different name.
 */
export async function addSnippet(
  ctx: MutationContext,
  args: AddSnippetArgs,
): Promise<Result<AddSnippetResult, MutationError>> {
  const id = args.id ?? slugify(args.name, "snippet");
  if (ctx.folder.snippets.has(id)) return err(snippetIdConflict(id));

  const snippet: Snippet = {
    id,
    name: args.name,
    params: args.params ?? [],
    tree: args.tree,
  };

  // Detect cycles against the existing registry plus the snippet we're about
  // to add. We don't know our own id yet from the registry's POV, so seed it.
  const registry = new Map(ctx.folder.snippets);
  registry.set(id, snippet);
  const cycle = detectSnippetCycle(args.tree, id, registry);
  if (cycle) return err(snippetCycle(id, cycle));

  const persisted = await persistSnippet(ctx.folder, id, snippet);
  ctx.broadcast({ type: "snippet-changed", snippetId: id });
  return ok({ snippetId: id, snippet: persisted });
}
