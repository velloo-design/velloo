import type { ComponentRegistry } from "@velloo/provider";
import {
  applySnippetExtraClassName,
  applySnippetOverrides,
  type ComponentNode,
  type InvalidParamPlacement,
  isComponentNode,
  isParamRef,
  isSnippetInstance,
  type Node,
  resolveSnippetArgs,
  type Snippet,
  type SnippetInstance,
  substituteSnippetParams,
} from "@velloo/schema";
import { cloneElement, createElement, Fragment, type ReactElement, type ReactNode } from "react";

export class UnknownComponentError extends Error {
  constructor(public readonly ref: string) {
    super(
      `Unknown component $ref="${ref}". Not in the active component provider's registry. ` +
        `("$ref" is a library component or registered extension; for a snippet use a {"$snippet":"<id>"} node or instantiate_snippet.)`,
    );
    this.name = "UnknownComponentError";
  }
}

export class UnknownSnippetError extends Error {
  constructor(public readonly snippetId: string) {
    super(`Unknown snippet $snippet="${snippetId}".`);
    this.name = "UnknownSnippetError";
  }
}

export class SnippetCycleError extends Error {
  readonly snippetId: string;
  readonly cycle: string[];
  constructor(snippetId: string, stack: string[]) {
    super(`Snippet cycle detected: ${[...stack, snippetId].join(" → ")}`);
    this.name = "SnippetCycleError";
    this.snippetId = snippetId;
    this.cycle = stack;
  }
}

export class SnippetParamError extends Error {
  constructor(
    public readonly snippetId: string,
    public readonly paramName: string,
    message?: string,
  ) {
    super(message ?? `Snippet "${snippetId}": required param "${paramName}" not supplied.`);
    this.name = "SnippetParamError";
  }
}

export class ParamRefError extends Error {
  constructor(public readonly paramName: string) {
    super(`$param "${paramName}" appears outside a snippet body.`);
    this.name = "ParamRefError";
  }
}

export interface BuildTreeOptions {
  /**
   * Component registry from the active provider. Required — the renderer
   * is provider-agnostic and never imports a registry directly.
   */
  registry: ComponentRegistry;
  /** Snippet registry used to resolve `$snippet` nodes. Required if the tree contains any. */
  snippets?: Map<string, Snippet> | undefined;
}

/**
 * Materialize a snippet instance: resolve args (declared params, defaults
 * for missing optional ones, error on missing required), then substitute
 * `$param` placeholders throughout the body. If the instance carries
 * `$extraClassName`, append it onto the resolved root's className so
 * one-off instances can layer styling without forking the snippet.
 */
export function resolveSnippetBody(instance: SnippetInstance, snippet: Snippet): Node {
  const { args, missing } = resolveSnippetArgs(snippet, instance.args ?? {});
  if (missing.length > 0) throw new SnippetParamError(snippet.id, missing[0] as string);
  const substituted = substituteSnippetParams(snippet.tree, args);
  if (substituted.missing.length > 0) {
    throw new SnippetParamError(snippet.id, substituted.missing[0] as string);
  }
  if (substituted.invalid.length > 0) {
    const bad = substituted.invalid[0] as InvalidParamPlacement;
    throw new SnippetParamError(
      snippet.id,
      bad.param,
      `Snippet "${snippet.id}": param "${bad.param}" resolved to a ${bad.valueType} but sits in a \`children\` array, where only nodes render. ` +
        `Pass a scalar param as a prop value, e.g. {"$ref":"Heading","props":{"children":{"$param":"${bad.param}"}}}. ` +
        `Only \`type:"node"\` params belong directly in children.`,
    );
  }
  let body = substituted.value as Node;
  if (instance.$overrides) {
    body = applySnippetOverrides(body, instance.$overrides);
  }
  const extra = instance.$extraClassName?.trim();
  if (!extra) return body;
  return applySnippetExtraClassName(body, extra);
}

/**
 * Walk the design Node tree and produce a React element tree.
 *
 * `lockedPath` is set when we descend into a resolved snippet body so every
 * DOM element inside the snippet inherits the *instance's* path. The canvas's
 * click-to-select logic then maps any click inside the snippet to the
 * instance node, which is the addressable unit from the page's POV.
 */
export function buildTree(
  node: Node,
  opts: BuildTreeOptions,
  path: number[] = [],
  stack: string[] = [],
  lockedPath: number[] | null = null,
): ReactElement {
  if (isSnippetInstance(node)) {
    const snippets = opts.snippets;
    if (!snippets) throw new UnknownSnippetError(node.$snippet);
    const snippet = snippets.get(node.$snippet);
    if (!snippet) throw new UnknownSnippetError(node.$snippet);
    if (stack.includes(snippet.id)) throw new SnippetCycleError(snippet.id, stack);
    const resolved = resolveSnippetBody(node, snippet);
    // Lock the path to the snippet instance's path so every inner DOM node
    // resolves back to the instance on click.
    return buildTree(resolved, opts, path, [...stack, snippet.id], lockedPath ?? path);
  }

  if (isParamRef(node)) {
    throw new ParamRefError(node.$param);
  }

  if (!isComponentNode(node)) {
    // Reached only for a malformed value sitting in a node position — a raw
    // string/number/object where a node was expected. Node positions render
    // nodes only; pass scalars as prop values, not as children.
    throw new Error(
      `buildTree: expected a component, snippet instance, or node param in a node position but got ${JSON.stringify(node)}`,
    );
  }

  const Component = opts.registry[node.$ref];
  if (!Component) throw new UnknownComponentError(node.$ref);

  const { children: childrenProp, ...restProps } = (node.props ?? {}) as Record<string, unknown>;
  const dataNodePath = (lockedPath ?? path).join(".");

  let children: ReactNode;
  if (Array.isArray(node.children) && node.children.length > 0) {
    // A `type:"node"` snippet param can resolve to *multiple* nodes — the
    // caller passes an array of nodes into the slot. Substitution leaves
    // that array in place (see substituteSnippetParams), so expand it into
    // sibling elements here: a node slot accepts either one node or a list.
    children = node.children.flatMap((child, i) =>
      Array.isArray(child)
        ? (child as Node[]).map((c, j) => buildTree(c, opts, [...path, i, j], stack, lockedPath))
        : buildTree(child, opts, [...path, i], stack, lockedPath),
    );
  } else if (childrenProp !== undefined) {
    children = resolvePropChildren(childrenProp, opts, path, stack, lockedPath);
  }

  return createElement(
    Component,
    { ...restProps, "data-node-path": dataNodePath, key: dataNodePath || "root" },
    children,
  );
}

/** A raw JSON value that is itself a node (component / snippet instance / param ref). */
function isNodeLike(v: unknown): v is Node {
  return (
    typeof v === "object" &&
    v !== null &&
    !Array.isArray(v) &&
    (isComponentNode(v as Node) || isSnippetInstance(v as Node) || isParamRef(v as Node))
  );
}

/**
 * Resolve a `children` *prop* value into renderable React content. Scalars
 * (string / number) pass through; node-shaped values — and arrays mixing the
 * two — are built into elements so inline rich text renders, e.g.
 * `children: ["You get ", {$ref:"Text", props:{className:"…", children:"the math right"}}]`
 * instead of crashing React with a raw object child. Inline nodes anchor to
 * the parent's path so a click selects the parent: like snippet-body nodes,
 * they're presentational content, not independently addressable.
 */
function resolvePropChildren(
  value: unknown,
  opts: BuildTreeOptions,
  path: number[],
  stack: string[],
  lockedPath: number[] | null,
): ReactNode {
  if (isNodeLike(value)) {
    return buildTree(value, opts, path, stack, lockedPath);
  }
  if (Array.isArray(value)) {
    return value.map((item, i) => {
      if (!isNodeLike(item)) return item as ReactNode;
      const el = buildTree(item, opts, path, stack, lockedPath);
      // biome-ignore lint/suspicious/noArrayIndexKey: inline children are positional content runs with no stable identity; index is the natural key
      return cloneElement(el, { key: `inline-${i}` });
    });
  }
  return value as ReactNode;
}

/**
 * Wrap the tree root in a Fragment so consumers can render it directly.
 */
export function buildRoot(node: Node, opts: BuildTreeOptions): ReactElement {
  return createElement(Fragment, null, buildTree(node, opts));
}

/**
 * Resolve a snippet body for *editing* in the canvas — preserves the
 * body's path space so clicks in the iframe map back to update_props
 * calls on the snippet tree.
 *
 * Param substitutions are scoped to *value positions* (props that
 * embed `$param` refs), not whole-node positions. A `$param` node
 * sitting as a child stays in the tree as a small Badge placeholder
 * so the path index for its siblings doesn't shift when a default is
 * substituted. The placeholder visibly shows "$<name>" so designers
 * see what's slotted in by each instance.
 */
export function resolveSnippetBodyForEdit(
  body: Node,
  paramDefaults: Record<string, unknown>,
  snippetId: string,
): Node {
  if (isParamRef(body)) {
    return placeholderForParam(body.$param);
  }
  if (isSnippetInstance(body)) {
    // Inner snippet instance: keep it. Nested-snippet edits happen by
    // opening that snippet directly.
    return body;
  }
  if (!isComponentNode(body)) return body;
  const nextProps = body.props
    ? (substituteSnippetParams(body.props, paramDefaults).value as Record<string, unknown>)
    : undefined;
  const nextChildren = body.children?.map((c) =>
    resolveSnippetBodyForEdit(c, paramDefaults, snippetId),
  );
  return {
    ...body,
    ...(nextProps ? { props: nextProps } : {}),
    ...(nextChildren ? { children: nextChildren } : {}),
  };
}

function placeholderForParam(name: string): ComponentNode {
  return {
    $ref: "Badge",
    props: {
      variant: "outline",
      className: "font-mono text-[10px] bg-muted/40 border-dashed text-muted-foreground",
      children: `$${name}`,
    },
  };
}
