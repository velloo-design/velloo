import { isComponentNode, isSnippetInstance, type Node, nodeId } from "./node.ts";

/**
 * Walk a node tree and return a map of `$id` → paths it appears at.
 * Snippet instance bodies are opaque from the host tree's POV; the
 * instance's own `$id` is recorded but the walker never descends into
 * snippet bodies (those ids belong to a different addressing scope).
 */
export function collectIds(root: Node): Map<string, number[][]> {
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

export interface DuplicateId {
  id: string;
  paths: number[][];
}

/**
 * Find every `$id` that appears more than once in a tree. Returns an
 * empty array when ids are unique.
 */
export function findDuplicateIds(root: Node): DuplicateId[] {
  const all = collectIds(root);
  const dupes: DuplicateId[] = [];
  for (const [id, paths] of all) {
    if (paths.length > 1) dupes.push({ id, paths });
  }
  return dupes;
}
