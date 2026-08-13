import { isComponentNode, isSnippetInstance, type Node, nodeId } from "@velloo/schema";

/**
 * Node-addressing primitive. Mutations accept either form:
 *
 * - `number[]` — direct path of child indices from the variant root.
 *   `[1, 2]` = third child of the second child of root. Brittle: a
 *   sibling insertion above shifts every later path.
 * - `string` — `@id` reference (must start with `@`). Resolved against
 *   the variant tree at mutation time. Stable across sibling insertions
 *   and deletions.
 *
 * Locators are validated and resolved at the lookup layer; mutation
 * cores see a `number[]` after resolution.
 */
export type Locator = number[] | string;

/** Convert a path array to its DOM string form ("0.2.1"; root = ""). */
export function pathToString(path: number[]): string {
  return path.join(".");
}

/** Inverse of `pathToString`. Empty string yields the root path []. */
export function pathFromString(s: string): number[] {
  if (s === "") return [];
  return s.split(".").map((part) => {
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0) {
      throw new Error(`pathFromString: invalid segment ${JSON.stringify(part)}`);
    }
    return n;
  });
}

/**
 * Resolve a path against a root node. Returns null if any index is out of
 * range OR if the path tries to descend into a non-component node (snippet
 * instances are opaque; param refs have no children).
 */
export function pathAt(root: Node, path: number[]): Node | null {
  let node: Node | undefined = root;
  for (const idx of path) {
    if (!node || !isComponentNode(node)) return null;
    if (!node.children || idx < 0 || idx >= node.children.length) return null;
    node = node.children[idx];
  }
  return node ?? null;
}

/** Return { parent: number[], index: number } for a non-root path; null for the root. */
export function parentOf(path: number[]): { parent: number[]; index: number } | null {
  if (path.length === 0) return null;
  const last = path[path.length - 1] as number;
  return { parent: path.slice(0, -1), index: last };
}

/** Coerce either a number[] or a "0.2.1" string into a number[]. */
export function coercePath(raw: unknown): number[] {
  if (Array.isArray(raw)) {
    return raw.map((n) => {
      if (!Number.isInteger(n) || n < 0) {
        throw new Error(`coercePath: invalid segment ${JSON.stringify(n)}`);
      }
      return n;
    });
  }
  if (typeof raw === "string") return pathFromString(raw);
  throw new Error(`coercePath: expected array or string, got ${typeof raw}`);
}

/** True if `value` looks like an @id locator string. */
export function isIdLocator(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("@") && value.length > 1;
}

/**
 * Walk the variant tree and find the path of the first node carrying `$id`
 * equal to `id`. Snippet instances are opaque — we check the instance's
 * own `$id` but never descend into a snippet body. Returns null if no
 * matching node exists.
 */
export function findById(root: Node, id: string): number[] | null {
  function walk(node: Node, path: number[]): number[] | null {
    if (nodeId(node) === id) return path;
    if (isSnippetInstance(node)) return null;
    if (!isComponentNode(node)) return null;
    if (!node.children) return null;
    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i];
      if (!child) continue;
      const found = walk(child, [...path, i]);
      if (found) return found;
    }
    return null;
  }
  return walk(root, []);
}

/**
 * Resolve a `Locator` (number[] or "@id" string) to a concrete path against
 * a variant root. Returns null when the locator doesn't resolve. The two
 * failure modes — out-of-range index vs unknown id — are distinguishable
 * by the caller via `isIdLocator(locator)`.
 */
export function resolveLocator(root: Node, locator: Locator): number[] | null {
  if (Array.isArray(locator)) {
    // Validate that the path resolves (so the result is "addressable").
    return pathAt(root, locator) === null ? null : locator;
  }
  if (isIdLocator(locator)) {
    return findById(root, locator.slice(1));
  }
  return null;
}

/**
 * One-shot: resolve a locator AND fetch the node at that path. Returns
 * `{ path, node }` on success — agents and mutations often need both.
 */
export function locate(root: Node, locator: Locator): { path: number[]; node: Node } | null {
  const path = resolveLocator(root, locator);
  if (path === null) return null;
  const node = pathAt(root, path);
  if (node === null) return null;
  return { path, node };
}
