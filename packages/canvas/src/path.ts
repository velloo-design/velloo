/** Convert canvas string path "0.2.1" → [0, 2, 1]. Empty string → []. */
export function pathFromString(s: string): number[] {
  if (s === "") return [];
  return s.split(".").map((p) => Number(p));
}

export function pathToString(p: number[]): string {
  return p.join(".");
}

/**
 * Address a node the way markup should store it: by `@id` when the node has
 * one, since a numeric path goes stale as soon as a sibling is added or moved.
 */
export function nodeLocator(node: object, path: string): number[] | string {
  if ("$id" in node && node.$id) return `@${String(node.$id)}`;
  return pathFromString(path);
}
