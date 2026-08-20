import { err, ok, type Result } from "@velloo/result";
import { type ComponentNode, isComponentNode, type Node } from "@velloo/schema";
import { invalidPath, type MutationError } from "./errors.ts";

/**
 * Addressing into a snippet instance's body. An `innerPath` is either:
 *  - `"@id"` — the node whose `$id` is `id`, found anywhere in the body
 *  - a dotted index path like `"0.2"` — walk children numerically
 *  - `""` — the body root itself
 *
 * Shared by `override_snippet_props` (which validates against the snippet
 * *definition* tree) and `inspect` (which resolves against the *expanded*
 * body). Substitution is value-level, not shape-level, so the same walk
 * applies to both.
 */

function findNodeById(root: Node, id: string): Node | undefined {
  if (!isComponentNode(root)) return undefined;
  if (root.$id === id) return root;
  for (const child of root.children ?? []) {
    const hit = findNodeById(child, id);
    if (hit) return hit;
  }
  return undefined;
}

/** True when `innerPath` lands on a component node inside `body`. */
export function innerPathResolves(body: Node, innerPath: string): boolean {
  if (innerPath.startsWith("@")) {
    return findNodeById(body, innerPath.slice(1)) !== undefined;
  }
  const segments = innerPath === "" ? [] : innerPath.split(".").map(Number);
  let cursor: Node | undefined = body;
  for (const i of segments) {
    if (!cursor || !isComponentNode(cursor) || !cursor.children) return false;
    cursor = cursor.children[i];
  }
  return cursor !== undefined && isComponentNode(cursor);
}

/**
 * Resolve an `innerPath` to the component node it addresses inside `body`,
 * or a precise `InvalidPath` error. `snippetId` is woven into the message
 * so the agent knows which snippet the path failed against.
 */
export function resolveInnerNode(
  body: Node,
  innerPath: string,
  snippetId: string,
): Result<ComponentNode, MutationError> {
  let target: Node | undefined;
  if (innerPath.startsWith("@")) {
    target = findNodeById(body, innerPath.slice(1));
  } else {
    const segments = innerPath === "" ? [] : innerPath.split(".").map(Number);
    target = body;
    for (const i of segments) {
      if (!target || !isComponentNode(target) || !target.children) {
        target = undefined;
        break;
      }
      target = target.children[i];
    }
  }
  if (!target || !isComponentNode(target)) {
    return err(
      invalidPath(
        `innerPath "${innerPath}" doesn't resolve to a component inside snippet "${snippetId}"`,
      ),
    );
  }
  return ok(target);
}
