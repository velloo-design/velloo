import { err, ok, type Result } from "@velloo/result";
import type { Node, Snippet, SnippetParam } from "@velloo/schema";
import type { MutationContext } from "./context.ts";
import { type MutationError, snippetCycle, snippetIdConflict } from "./errors.ts";
import { persistSnippet } from "./persist.ts";
import { detectSnippetCycle } from "./snippet-cycle.ts";

export interface AddSnippetArgs {
  /** Display name. Id is slug(name) unless `id` provided. */
  name: string;
  id?: string;
  params: SnippetParam[];
  tree: Node;
}

export interface AddSnippetResult {
  snippetId: string;
  snippet: Snippet;
}

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "snippet"
  );
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
  const id = args.id ?? slugify(args.name);
  if (ctx.folder.snippets.has(id)) return err(snippetIdConflict(id));

  const snippet: Snippet = {
    id,
    name: args.name,
    params: args.params,
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
