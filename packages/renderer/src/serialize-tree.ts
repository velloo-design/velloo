import {
  type ComponentNode,
  isComponentNode,
  isParamRef,
  isRepoNode,
  isSnippetInstance,
  type Node,
  type RepoComponentRef,
  repoKey,
  type Snippet,
} from "@velloo/schema";
import { repoProxyInstance, resolveSnippetBody } from "./build-tree.ts";

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
  /**
   * Set on a repository component: `ref` is then its {@link repoKey}, and the
   * bundle registers the real export under that key. `name` is the JSX name the
   * design uses, for fallbacks and diagnostics.
   */
  repo?: RepoComponentRef & { name: string };
  /** The proxy subtree drawn when the real component is unavailable or throws. */
  proxy?: SerializedNode;
}

/**
 * A node-valued prop on a repository component (`leftSection`, `icon`) — the
 * client interpreter turns it into an element before handing the props over,
 * since the component expects a React node there, not design JSON.
 */
export interface SerializedSlot {
  $node: SerializedNode;
}

/** Distinct repository identities in a serialized tree, keyed by their runtime ref. */
export function collectSerializedRepoRefs(
  tree: SerializedNode | null,
): Map<string, RepoComponentRef & { name: string }> {
  const out = new Map<string, RepoComponentRef & { name: string }>();
  const visitValue = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visitValue(item);
    } else if (value && typeof value === "object" && "$node" in value) {
      visit((value as SerializedSlot).$node);
    }
  };
  const visit = (node: SerializedNode): void => {
    if (node.repo && !out.has(node.ref)) out.set(node.ref, node.repo);
    if (node.proxy) visit(node.proxy);
    for (const value of Object.values(node.props ?? {})) visitValue(value);
    for (const child of node.children ?? []) if (typeof child === "object") visit(child);
  };
  if (tree) visit(tree);
  return out;
}

export interface SerializeOptions {
  snippets?: Map<string, Snippet> | undefined;
  /**
   * Component refs the browser bundle has no source for, drawn from their
   * server render instead (see {@link STATIC_REF}). `render` returns that
   * node's SSR markup; the client drops it in unchanged, identity attributes
   * and all, so selection still resolves inside it.
   */
  staticFallback?:
    | {
        refs: ReadonlySet<string>;
        render(node: Node, path: number[], lockedPath: number[] | null): string;
      }
    | undefined;
}

/**
 * The ref a {@link SerializeOptions.staticFallback} node serializes to. The
 * bundle registers a component for it that injects `props.html`.
 */
export const STATIC_REF = "velloo:static";

/** Distinct component refs in a serialized tree, stable in first-use order. */
export function collectSerializedRefs(tree: SerializedNode | null): string[] {
  if (!tree) return [];
  const seen = new Set<string>();
  const visitValue = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visitValue(item);
    } else if (value && typeof value === "object" && "$node" in value) {
      visit((value as SerializedSlot).$node);
    }
  };
  const visit = (node: SerializedNode): void => {
    seen.add(node.ref);
    if (node.proxy) visit(node.proxy);
    for (const value of Object.values(node.props ?? {})) visitValue(value);
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

  if (!isRepoNode(node) && opts.staticFallback?.refs.has(node.$ref)) {
    return {
      ref: STATIC_REF,
      props: { html: opts.staticFallback.render(node, path, lockedPath) },
    };
  }

  const { children: childrenProp, ...rawProps } = (node.props ?? {}) as Record<string, unknown>;
  const repo = isRepoNode(node);
  const restProps = repo ? serializeSlotProps(rawProps, opts, path, stack, lockedPath) : rawProps;
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

  const proxy = repo ? serializeProxy(node, opts, path, stack, lockedPath) : null;
  return {
    ref: repo ? repoKey(node.$repo) : node.$ref,
    ...(repo ? { repo: { ...node.$repo, name: node.$ref } } : {}),
    ...(proxy ? { proxy } : {}),
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

function serializeProxy(
  node: ComponentNode & { $repo: RepoComponentRef },
  opts: SerializeOptions,
  path: number[],
  stack: string[],
  lockedPath: number[] | null,
): SerializedNode | null {
  const snippet = node.$repo.proxy ? opts.snippets?.get(node.$repo.proxy) : undefined;
  if (!snippet || stack.includes(snippet.id)) return null;
  try {
    return serializeTree(repoProxyInstance(node, snippet), opts, path, stack, lockedPath ?? path);
  } catch {
    // A proxy missing a required arg is a proxy that can't draw — the client
    // falls back to the labelled frame, exactly like SSR would have thrown on it.
    return null;
  }
}

/** Node-valued props become {@link SerializedSlot}s; everything else passes through. */
function serializeSlotProps(
  props: Record<string, unknown>,
  opts: SerializeOptions,
  path: number[],
  stack: string[],
  lockedPath: number[] | null,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(props)) {
    if (isNodeLike(value)) {
      const s = serializeTree(value, opts, path, stack, lockedPath ?? path);
      if (s) out[name] = { $node: s } satisfies SerializedSlot;
    } else {
      out[name] = value;
    }
  }
  return out;
}
