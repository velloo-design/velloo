import { isComponentNode, isSnippetInstance, type Node, type Screen } from "@velloo/schema";

/**
 * Walk a screen tree and collect snippet ids that are instantiated. Used by
 * remove_snippet to refuse if screens depend on it, and by update_snippet
 * to know which screens to re-broadcast.
 */
export function snippetIdsReferencedBy(screen: Screen): Set<string> {
  const out = new Set<string>();
  collectSnippets(screen.tree, out);
  return out;
}

function collectSnippets(node: Node, out: Set<string>): void {
  if (isSnippetInstance(node)) {
    out.add(node.$snippet);
    return;
  }
  if (isComponentNode(node) && node.children) {
    for (const child of node.children) collectSnippets(child, out);
  }
}
