import {
  type ComponentNode,
  type EmitAsRef,
  isComponentNode,
  isParamRef,
  isSnippetInstance,
  isTextNode,
  type Node,
  type ParamRef,
  type RepoComponentRef,
  type SnippetInstance,
  type TextNode,
} from "./node.ts";

/**
 * A `$ref` the renderer resolves itself rather than through any registry.
 * Synthetic refs are never persisted — a preview synthesizes them — and every
 * provider has to be able to draw them, so they can't be library components
 * (a `none` folder has no `Badge` to draw a param slot with).
 */
export const PARAM_TAG_REF = "velloo:param-tag";

/**
 * The ref a node serializes to when the canvas bundle has no browser source
 * for it and the client must drop in its server render instead.
 */
export const STATIC_REF = "velloo:static";

export type SyntheticRef = typeof PARAM_TAG_REF | typeof STATIC_REF;

const SYNTHETIC_REFS: readonly SyntheticRef[] = [PARAM_TAG_REF, STATIC_REF];

export function isSyntheticRef(ref: string): ref is SyntheticRef {
  return (SYNTHETIC_REFS as readonly string[]).includes(ref);
}

/** A component node carrying a repository identity (see {@link ComponentNode.$repo}). */
export type RepoNode = ComponentNode & { $repo: RepoComponentRef };

/** A component node carrying an emit-time host facade (see {@link ComponentNode.$emitAs}). */
export type EmitAsNode = ComponentNode & { $emitAs: EmitAsRef };

/**
 * What a node's own fields say it is. Purely structural: no registry, no
 * catalog, no I/O — a `named` shape is as far as the node alone can go, and
 * `resolveNodeIdentity` in `@velloo/provider` takes it from there.
 *
 * The order of the `$`-keys is the contract, stated here once and nowhere
 * else: `$snippet`, then `$param`, then a component — where an identity
 * (`$repo`) beats an emit-time facade (`$emitAs`) beats a synthetic ref beats
 * a plain name — then `$text`. A malformed value carrying both `$snippet` and `$ref` is a
 * snippet instance, as every walker has always read it.
 */
export type NodeShape =
  | { kind: "repo"; node: RepoNode; ref: string; repo: RepoComponentRef }
  | { kind: "emit-as"; node: EmitAsNode; ref: string; emitAs: EmitAsRef }
  | { kind: "synthetic"; node: ComponentNode; ref: SyntheticRef }
  | { kind: "named"; node: ComponentNode; ref: string }
  | { kind: "snippet"; node: SnippetInstance }
  | { kind: "param"; node: ParamRef }
  /** A run of text beside elements: a bare text node, no element of its own. */
  | { kind: "text"; node: TextNode; text: string }
  /** Not a node at all — a raw scalar or object sitting in a node position. */
  | { kind: "invalid"; value: unknown };

/** Discriminate a value by its own fields. Accepts `unknown`: node positions are a trust boundary. */
export function nodeShape(value: unknown): NodeShape {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { kind: "invalid", value };
  }
  const node = value as Node;
  if (isSnippetInstance(node)) return { kind: "snippet", node };
  if (isParamRef(node)) return { kind: "param", node };
  if (isComponentNode(node)) {
    if (node.$repo !== undefined) {
      return { kind: "repo", node: node as RepoNode, ref: node.$ref, repo: node.$repo };
    }
    if (node.$emitAs !== undefined) {
      return { kind: "emit-as", node: node as EmitAsNode, ref: node.$ref, emitAs: node.$emitAs };
    }
    if (isSyntheticRef(node.$ref)) {
      return { kind: "synthetic", node, ref: node.$ref };
    }
    return { kind: "named", node, ref: node.$ref };
  }
  if (isTextNode(node)) return { kind: "text", node, text: node.$text };
  return { kind: "invalid", value };
}

/**
 * Whether a raw JSON value is itself a node. The check every walker needs when
 * it meets a *prop* value — a `children` prop carrying inline rich text, a slot
 * prop holding an icon — where a node and a plain value are both legal.
 */
export function isNode(value: unknown): value is Node {
  return nodeShape(value).kind !== "invalid";
}
