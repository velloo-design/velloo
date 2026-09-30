import {
  type ComponentNode,
  isNode,
  type Node,
  nodeShape,
  type RepoComponentRef,
  type RepoNode,
  repoKey,
  type Snippet,
  STATIC_REF,
} from "@velloo/schema";
import { repoProxyInstance, resolveSnippetBody } from "./build-tree.ts";
import { type BodyPosition, bodyAttributes, descend, enterSnippet } from "./snippet-body.ts";

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
  // The shape, not the resolved identity: the serializer needs only a node's
  // name, and what the name *means* is the bundle's problem — a library
  // component, an extension placeholder and a facade's approximation subtree
  // all register under their `$ref` on the client exactly as they do in SSR.
  const shape = nodeShape(node);
  switch (shape.kind) {
    case "snippet": {
      const instance = shape.node;
      const snippet = opts.snippets?.get(instance.$snippet);
      if (!snippet || stack.includes(snippet.id)) return null;
      const resolved = resolveSnippetBody(instance, snippet);
      return serializeTree(
        resolved,
        opts,
        path,
        [...stack, snippet.id],
        lockedPath ?? path,
        enterSnippet(body, snippet.id),
      );
    }
    // An unresolvable node (a stray `$param`, a value that isn't a node at
    // all) drops the whole client mount back to SSR — see the return contract.
    case "param":
    case "invalid":
      return null;
    case "repo":
      return serializeRepo(shape.node, opts, path, stack, lockedPath, body);
    case "synthetic":
    case "named":
    case "emit-as": {
      const { node: component, ref } = shape;
      // A ref the browser bundle has no source for: the client drops in this
      // node's server render unchanged, identity attributes and all, so
      // selection still resolves inside it. A repository node never takes this
      // path — the bundle is exactly where its real component lives.
      if (opts.staticFallback?.refs.has(ref)) {
        const html = opts.staticFallback.render(component, path, lockedPath);
        return { ref: STATIC_REF, props: { html } };
      }
      return serializeComponent(component, opts, path, stack, lockedPath, body);
    }
  }
}

function serializeComponent(
  node: ComponentNode,
  opts: SerializeOptions,
  path: number[],
  stack: string[],
  lockedPath: number[] | null,
  body: BodyPosition | null,
): SerializedNode {
  const { children: childrenProp, ...props } = (node.props ?? {}) as Record<string, unknown>;
  return {
    ref: node.$ref,
    props: nodeProps(props, path, lockedPath, body),
    ...serializeChildren(node, childrenProp, opts, path, stack, lockedPath, body),
  };
}

/**
 * A repository component registers under its {@link repoKey} rather than its
 * JSX name, carries node-valued slot props, and ships its proxy subtree for the
 * client to fall back to.
 */
function serializeRepo(
  node: RepoNode,
  opts: SerializeOptions,
  path: number[],
  stack: string[],
  lockedPath: number[] | null,
  body: BodyPosition | null,
): SerializedNode {
  const { children: childrenProp, ...rawProps } = (node.props ?? {}) as Record<string, unknown>;
  const props = serializeSlotProps(rawProps, opts, path, stack, lockedPath);
  const proxy = serializeProxy(node, opts, path, stack, lockedPath);
  return {
    ref: repoKey(node.$repo),
    repo: { ...node.$repo, name: node.$ref },
    ...(proxy ? { proxy } : {}),
    props: nodeProps(props, path, lockedPath, body),
    ...serializeChildren(node, childrenProp, opts, path, stack, lockedPath, body),
  };
}

function nodeProps(
  props: Record<string, unknown>,
  path: number[],
  lockedPath: number[] | null,
  body: BodyPosition | null,
): Record<string, unknown> {
  return {
    ...props,
    "data-node-path": (lockedPath ?? path).join("."),
    ...bodyAttributes(body),
  };
}

function serializeChildren(
  node: ComponentNode,
  childrenProp: unknown,
  opts: SerializeOptions,
  path: number[],
  stack: string[],
  lockedPath: number[] | null,
  body: BodyPosition | null,
): { children?: Child[] } {
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
  return children && children.length > 0 ? { children } : {};
}

/** Serialize a `children` *prop* value: scalars pass through, node-shaped values resolve. */
function serializePropChildren(
  value: unknown,
  opts: SerializeOptions,
  path: number[],
  stack: string[],
  lockedPath: number[] | null,
): Child[] | undefined {
  if (isNode(value)) {
    const s = serializeTree(value, opts, path, stack, lockedPath);
    return s ? [s] : undefined;
  }
  if (Array.isArray(value)) {
    const out: Child[] = [];
    for (const item of value) {
      if (isNode(item)) {
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
  node: RepoNode,
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
    if (isNode(value)) {
      const s = serializeTree(value, opts, path, stack, lockedPath ?? path);
      if (s) out[name] = { $node: s } satisfies SerializedSlot;
    } else {
      out[name] = value;
    }
  }
  return out;
}
