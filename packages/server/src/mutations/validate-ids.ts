import { err, ok, type Result } from "@velloo/result";
import { isComponentNode, isSnippetInstance, type Node, nodeId, type Page } from "@velloo/schema";
import { idConflict, type MutationError } from "./errors.ts";

/**
 * Walk a single variant tree and return a map of `$id` → paths it
 * appears at. Snippet instance bodies are opaque from the page's POV;
 * we record the instance's own `$id` but never descend into a snippet
 * body (those ids belong to a different addressing scope).
 */
export function collectIdsInVariant(root: Node): Map<string, number[][]> {
  const out = new Map<string, number[][]>();
  function walk(node: Node, path: number[]): void {
    const id = nodeId(node);
    if (id !== undefined) {
      const existing = out.get(id);
      if (existing) existing.push([...path]);
      else out.set(id, [[...path]]);
    }
    if (isSnippetInstance(node)) return;
    if (!isComponentNode(node)) return;
    if (!node.children) return;
    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i];
      if (child) walk(child, [...path, i]);
    }
  }
  walk(root, []);
  return out;
}

/**
 * Per-variant `$id` uniqueness check on a whole page. Returns ok if
 * every variant has unique ids internally; err on the first duplicate.
 *
 * The same `$id` may legally repeat across variants (e.g. "hero-cta"
 * on mobile + desktop is the same logical anchor); cross-variant
 * duplication is not a conflict.
 */
export function validatePageIds(pageId: string, page: Page): Result<void, MutationError> {
  for (const variant of page.variants) {
    const ids = collectIdsInVariant(variant.tree);
    for (const [id, paths] of ids) {
      if (paths.length > 1) return err(idConflict(pageId, variant.id, id, paths));
    }
  }
  return ok(undefined);
}
