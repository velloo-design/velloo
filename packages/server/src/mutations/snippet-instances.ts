import { isComponentNode, isSnippetInstance, type Node, type Screen } from "@velloo/schema";
import type { DesignFolder } from "../design-folder.ts";

export interface SnippetInstanceLocation {
  screenId: string;
  /** Dotted path from screen root to the instance, "" for root. */
  path: string;
  /** Whether the instance carries a per-instance className override. */
  hasOverride: boolean;
  /** The args the instance passes — lets callers re-validate against changed params. */
  args: Record<string, unknown>;
}

/**
 * Walk every screen + snippet body and collect locations of every
 * instance of `snippetId`. Snippet bodies count too: a snippet that
 * embeds `feature-row` shows up as one location with screenId set to
 * the host snippet's id, prefixed with "snippet:".
 *
 * Used by the canvas's "instances" widget so a designer can answer
 * "how many places does this snippet touch?" before editing it.
 */
export function findSnippetInstances(
  folder: DesignFolder,
  snippetId: string,
): SnippetInstanceLocation[] {
  const out: SnippetInstanceLocation[] = [];

  function walk(node: Node, path: number[], screenIdLabel: string): void {
    if (isSnippetInstance(node)) {
      if (node.$snippet === snippetId) {
        out.push({
          screenId: screenIdLabel,
          path: path.join("."),
          hasOverride: typeof node.$extraClassName === "string" && node.$extraClassName !== "",
          args: node.args ?? {},
        });
      }
      // Snippet instance bodies are opaque from this walk's POV.
      return;
    }
    if (!isComponentNode(node)) return;
    if (!node.children) return;
    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i];
      if (child) walk(child, [...path, i], screenIdLabel);
    }
  }

  for (const [id, screen] of folder.screens as Map<string, Screen>) {
    walk(screen.tree, [], id);
  }
  for (const [id, snippet] of folder.snippets) {
    if (id === snippetId) continue;
    walk(snippet.tree, [], `snippet:${id}`);
  }

  return out;
}
