import type { Screen } from "@velloo/schema";
import type { DesignFolder } from "../design-folder.ts";

/**
 * Every snippet id named anywhere inside a value.
 *
 * A generic JSON walk, not a tree walk. A `$snippet` is not only a child
 * node: a node-typed arg carries a whole subtree, `$overrides` hold props
 * bags, and a props value can be a node too (substitution already treats
 * props as opaque JSON). Over-counting a reference here costs nothing —
 * missing one deletes a snippet something still renders.
 */
export function snippetIdsIn(value: unknown, out: Set<string> = new Set()): Set<string> {
  if (value === null || typeof value !== "object") return out;
  if (Array.isArray(value)) {
    for (const item of value) snippetIdsIn(item, out);
    return out;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.$snippet === "string") out.add(record.$snippet);
  for (const nested of Object.values(record)) snippetIdsIn(nested, out);
  return out;
}

/**
 * Snippet ids reachable from `roots`, following snippet→snippet references
 * transitively.
 *
 * Screens are the only roots that exist: a snippet has no placement of its
 * own, so one that no screen reaches — directly or through another snippet —
 * is a file nothing renders. A missing body is skipped rather than fatal;
 * a dangling reference is a broken screen, not a reason to stop counting.
 */
export function reachableSnippetIds(folder: DesignFolder, roots: Iterable<Screen>): Set<string> {
  const reached = new Set<string>();
  const pending: string[] = [];
  const push = (from: unknown) => {
    for (const id of snippetIdsIn(from)) {
      if (reached.has(id)) continue;
      reached.add(id);
      pending.push(id);
    }
  };
  for (const screen of roots) push(screen);
  // The visited set doubles as the cycle guard — snippet-cycle.ts refuses one
  // at write time, but a folder edited by hand can still hold one.
  while (pending.length > 0) {
    const body = folder.snippets.get(pending.pop() as string);
    if (body) push(body);
  }
  return reached;
}

/**
 * Snippets no screen reaches. Files on disk that render nowhere: the library
 * still lists them and `emit_snippet` still emits them, so they're inert
 * rather than broken — but they're also what a cascade leaves behind and what
 * an agent should be able to ask about.
 *
 * Returned sorted, so a listing is stable across calls.
 */
export function unusedSnippetIds(folder: DesignFolder): string[] {
  const reachable = reachableSnippetIds(folder, folder.screens.values());
  return [...folder.snippets.keys()].filter((id) => !reachable.has(id)).sort();
}

/**
 * What names `snippetId`: screen ids, and host snippet ids for a snippet that
 * embeds it. Split because they're different cleanups — an instance in a
 * screen goes away with `remove_node`, one in a snippet body with
 * `update_snippet`.
 */
export function snippetReferencers(
  folder: DesignFolder,
  snippetId: string,
): { screenIds: string[]; snippetIds: string[] } {
  const screenIds: string[] = [];
  for (const [id, screen] of folder.screens) {
    if (snippetIdsIn(screen).has(snippetId)) screenIds.push(id);
  }
  const snippetIds: string[] = [];
  for (const [id, snippet] of folder.snippets) {
    if (id === snippetId) continue;
    if (snippetIdsIn(snippet).has(snippetId)) snippetIds.push(id);
  }
  return { screenIds, snippetIds };
}
