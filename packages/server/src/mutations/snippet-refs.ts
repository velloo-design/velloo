import { isComponentNode, isSnippetInstance, type Node, type Page } from "@velloo/schema";

/**
 * Walk a page tree (all variants) and collect snippet ids that are
 * instantiated. Used by remove_snippet to refuse if pages depend on it
 * and by update_snippet to know which pages to re-broadcast.
 */
export function snippetIdsReferencedBy(page: Page): Set<string> {
  const out = new Set<string>();
  for (const variant of page.variants) collectSnippets(variant.tree, out);
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

/** Map of snippetId → pageIds that reference it. */
export function snippetUsageIndex(pages: Map<string, Page>): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [pageId, page] of pages) {
    for (const id of snippetIdsReferencedBy(page)) {
      const list = out.get(id);
      if (list) list.push(pageId);
      else out.set(id, [pageId]);
    }
  }
  return out;
}
