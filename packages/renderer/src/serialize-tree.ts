import {
  isComponentNode,
  isParamRef,
  isSnippetInstance,
  type Node,
  type Snippet,
} from "@velloo/schema";
import { resolveSnippetBody } from "./build-tree.ts";

/**
 * A screen tree resolved to plain JSON for the framework-native canvas bundle's
 * client interpreter (#18): snippet instances + params are inlined server-side,
 * `data-node-path` and the snippet-body markers are baked into props (so client
 * clicks still select, and a snippet is still editable in place), and the shape
 * is `{ ref, props, children }` — a mirror of what `buildTree` feeds
 * `createElement`, minus React. A `string`/`number` child is text content.
 *
 * Being a mirror is load-bearing: this output *replaces* the SSR DOM, so
 * anything `buildTree` bakes in that this drops stops existing on the page the
 * user is actually clicking.
 */
export interface SerializedNode {
  ref: string;
  props?: Record<string, unknown>;
  children?: (SerializedNode | string | number)[];
}

export interface SerializeOptions {
  snippets?: Map<string, Snippet> | undefined;
}

/** Distinct component refs in a serialized tree, stable in first-use order. */
export function collectSerializedRefs(tree: SerializedNode | null): string[] {
  if (!tree) return [];
  const seen = new Set<string>();
  const visit = (node: SerializedNode): void => {
    seen.add(node.ref);
    for (const child of node.children ?? []) {
      if (typeof child === "object") visit(child);
    }
  };
  visit(tree);
  return [...seen];
}

type Child = SerializedNode | string | number;

/**
 * Resolve a node tree to {@link SerializedNode} JSON — the exact resolution
 * `buildTree` does (snippet bodies, node/param children, inline-rich-text
 * children props, locked paths for snippet selection), serialized instead of
 * turned into React elements. Returns null for an unresolvable node (a missing
 * snippet, a stray `$param`, a cycle) so the caller can fall back to SSR.
 */
export function serializeTree(
  node: Node,
  opts: SerializeOptions,
  path: number[] = [],
  stack: string[] = [],
  lockedPath: number[] | null = null,
  body: BodyPosition | null = null,
): SerializedNode | null {
  if (isSnippetInstance(node)) {
    const snippet = opts.snippets?.get(node.$snippet);
    if (!snippet || stack.includes(snippet.id)) return null;
    const resolved = resolveSnippetBody(node, snippet);
    return serializeTree(resolved, opts, path, [...stack, snippet.id], lockedPath ?? path, {
      snippetId: snippet.id,
      path: [],
    });
  }
  if (isParamRef(node)) return null;
  if (!isComponentNode(node)) return null;

  const { children: childrenProp, ...restProps } = (node.props ?? {}) as Record<string, unknown>;
  const dataNodePath = (lockedPath ?? path).join(".");

  let children: Child[] | undefined;
  if (Array.isArray(node.children) && node.children.length > 0) {
    children = node.children
      .flatMap((child, i) =>
        Array.isArray(child)
          ? // An expanded slot has no counterpart position in the definition,
            // so nothing inside it is addressable as snippet body.
            (child as Node[]).map((c, j) =>
              serializeTree(c, opts, [...path, i, j], stack, lockedPath, null),
            )
          : serializeTree(child, opts, [...path, i], stack, lockedPath, descend(body, i)),
      )
      .filter((c): c is SerializedNode => c !== null);
  } else if (childrenProp !== undefined) {
    children = serializePropChildren(childrenProp, opts, path, stack, lockedPath);
  }

  return {
    ref: node.$ref,
    props: {
      ...restProps,
      "data-node-path": dataNodePath,
      ...(body === null
        ? {}
        : { "data-snippet-id": body.snippetId, "data-snippet-path": body.path.join(".") }),
    },
    ...(children && children.length > 0 ? { children } : {}),
  };
}

/** Where a node sits inside the snippet definition it was materialized from. */
interface BodyPosition {
  snippetId: string;
  path: number[];
}

function descend(body: BodyPosition | null, index: number): BodyPosition | null {
  return body === null ? null : { snippetId: body.snippetId, path: [...body.path, index] };
}

/** A raw JSON value that is itself a node (mirror of build-tree's isNodeLike). */
function isNodeLike(v: unknown): v is Node {
  return (
    typeof v === "object" &&
    v !== null &&
    !Array.isArray(v) &&
    (isComponentNode(v as Node) || isSnippetInstance(v as Node) || isParamRef(v as Node))
  );
}

/** Serialize a `children` *prop* value: scalars pass through, node-shaped values resolve. */
function serializePropChildren(
  value: unknown,
  opts: SerializeOptions,
  path: number[],
  stack: string[],
  lockedPath: number[] | null,
): Child[] | undefined {
  if (isNodeLike(value)) {
    const s = serializeTree(value, opts, path, stack, lockedPath);
    return s ? [s] : undefined;
  }
  if (Array.isArray(value)) {
    const out: Child[] = [];
    for (const item of value) {
      if (isNodeLike(item)) {
        const s = serializeTree(item, opts, path, stack, lockedPath);
        if (s) out.push(s);
      } else if (typeof item === "string" || typeof item === "number") {
        out.push(item);
      }
    }
    return out.length > 0 ? out : undefined;
  }
  if (typeof value === "string" || typeof value === "number") return [value];
  return undefined;
}
