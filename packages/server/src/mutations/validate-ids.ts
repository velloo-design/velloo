import { err, ok, type Result } from "@velloo/result";
import {
  isComponentNode,
  isSnippetInstance,
  type Node,
  nodeId,
  type Screen,
} from "@velloo/schema";
import { idConflict, type MutationError } from "./errors.ts";

/**
 * Walk a screen tree and return a map of `$id` → paths it appears at.
 * Snippet instance bodies are opaque from the screen's POV; we record
 * the instance's own `$id` but never descend into a snippet body
 * (those ids belong to a different addressing scope).
 */
export function collectIdsInScreen(root: Node): Map<string, number[][]> {
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
 * `$id` uniqueness check on a screen. Returns ok if ids are unique within
 * the screen tree; err on the first duplicate.
 */
export function validateScreenIds(screenId: string, screen: Screen): Result<void, MutationError> {
  const ids = collectIdsInScreen(screen.tree);
  for (const [id, paths] of ids) {
    if (paths.length > 1) return err(idConflict(screenId, id, paths));
  }
  return ok(undefined);
}
