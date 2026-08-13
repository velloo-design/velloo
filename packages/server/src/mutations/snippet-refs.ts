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

/** Map of snippetId → screenIds that reference it. */
export function snippetUsageIndex(screens: Map<string, Screen>): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [screenId, screen] of screens) {
    for (const id of snippetIdsReferencedBy(screen)) {
      const list = out.get(id);
      if (list) list.push(screenId);
      else out.set(id, [screenId]);
    }
  }
  return out;
}
