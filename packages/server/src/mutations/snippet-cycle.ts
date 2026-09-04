import { isSnippetInstance, type Node, type Snippet } from "@velloo/schema";

/**
 * Walk a snippet body and report the chain of snippet IDs reached (excluding
 * the root). Used to detect cycles before persisting a snippet.
 */
export function detectSnippetCycle(
  root: Node,
  rootId: string,
  registry: Map<string, Snippet>,
): string[] | null {
  const stack: string[] = [rootId];
  const visited = new Set<string>([rootId]);

  function walk(node: Node): string[] | null {
    if (isSnippetInstance(node)) {
      const id = node.$snippet;
      if (visited.has(id)) {
        return [...stack, id];
      }
      const inner = registry.get(id);
      if (!inner) return null; // missing snippet — let runtime resolution surface that
      visited.add(id);
      stack.push(id);
      const found = walk(inner.tree);
      stack.pop();
      visited.delete(id);
      if (found) return found;
      return null;
    }
    // Component or param ref — descend into children if present.
    if ((node as { children?: Node[] | undefined }).children) {
      for (const child of (node as { children: Node[] }).children) {
        const found = walk(child);
        if (found) return found;
      }
    }
    return null;
  }

  return walk(root);
}
