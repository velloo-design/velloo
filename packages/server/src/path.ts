import type { Node } from "@velloo/schema";

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

/** Resolve a path against a root node. Returns null if any index is out of range. */
export function pathAt(root: Node, path: number[]): Node | null {
  let node: Node | undefined = root;
  for (const idx of path) {
    if (!node?.children || idx < 0 || idx >= node.children.length) return null;
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
