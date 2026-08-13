import {
  isComponentNode,
  isParamRef,
  isSnippetInstance,
  type Node,
  type Snippet,
  type SnippetInstance,
} from "@velloo/schema";
import { isKnownComponent, registry } from "@velloo/shadcn-snapshot";
import { createElement, Fragment, type ReactElement, type ReactNode } from "react";

export class UnknownComponentError extends Error {
  constructor(public readonly ref: string) {
    super(`Unknown component $ref="${ref}". Not in @velloo/shadcn-snapshot registry.`);
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
  /** Snippet registry used to resolve `$snippet` nodes. Required if the tree contains any. */
  snippets?: Map<string, Snippet>;
}

/**
 * Recursively rewrite snippet body values:
 *
 * - `{ $param: "name" }` → `args.name` (the param's value, of any JSON type).
 * - `{ $if: "name", then: <a>, else: <b> }` → `<a>` if `args.name` is truthy,
 *   else `<b>`. Recurses into both branches first so nested $param/$if work.
 *
 * Walks props as well as children — agents commonly inject string params
 * into `props.children` and toggle class strings with `$if`.
 */
function substituteParams(
  value: unknown,
  args: Record<string, unknown>,
  snippetId: string,
): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => substituteParams(v, args, snippetId));
  if (typeof (value as { $param?: unknown }).$param === "string") {
    const name = (value as { $param: string }).$param;
    if (!(name in args)) throw new SnippetParamError(snippetId, name);
    return args[name];
  }
  if (typeof (value as { $if?: unknown }).$if === "string") {
    const v = value as { $if: string; then?: unknown; else?: unknown };
    if (!(v.$if in args)) throw new SnippetParamError(snippetId, v.$if);
    const branch = isTruthy(args[v.$if]) ? v.then : v.else;
    return substituteParams(branch, args, snippetId);
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = substituteParams(v, args, snippetId);
  }
  return out;
}

function isTruthy(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0 && !Number.isNaN(v);
  if (typeof v === "string") return v !== "";
  return true;
}

/**
 * Materialize a snippet instance: resolve args (declared params, defaults
 * for missing optional ones, error on missing required), then substitute
 * `$param` placeholders throughout the body. If the instance carries
 * `$extraClassName`, append it onto the resolved root's className so
 * one-off instances can layer styling without forking the snippet.
 */
function resolveSnippetBody(instance: SnippetInstance, snippet: Snippet): Node {
  const resolvedArgs: Record<string, unknown> = {};
  const passed = instance.args ?? {};
  for (const param of snippet.params) {
    if (param.name in passed) {
      resolvedArgs[param.name] = passed[param.name];
    } else if (param.default !== undefined) {
      resolvedArgs[param.name] = param.default;
    } else {
      throw new SnippetParamError(snippet.id, param.name);
    }
  }
  const body = substituteParams(snippet.tree, resolvedArgs, snippet.id) as Node;
  const extra = instance.$extraClassName?.trim();
  if (!extra) return body;
  return applyExtraClassName(body, extra);
}

/**
 * Push an extra className onto a resolved snippet body's root node. If the
 * root is itself a snippet instance (snippet of a snippet), forward the
 * extra to that instance's `$extraClassName` — the nested resolution will
 * cascade it down. Param refs and arg roots without a `props` shape can't
 * carry a className; in that case we ignore (returning the body unchanged
 * preserves the user's input rather than throwing).
 */
function applyExtraClassName(node: Node, extra: string): Node {
  if (isParamRef(node)) return node;
  if (isSnippetInstance(node)) {
    const existing = node.$extraClassName ? `${node.$extraClassName} ${extra}` : extra;
    return { ...node, $extraClassName: existing };
  }
  if (!isComponentNode(node)) return node;
  const existingClass =
    typeof node.props?.className === "string" ? (node.props.className as string) : "";
  const merged = existingClass ? `${existingClass} ${extra}` : extra;
  return {
    ...node,
    props: { ...(node.props ?? {}), className: merged },
  };
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
  path: number[] = [],
  opts: BuildTreeOptions = {},
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
    return buildTree(resolved, path, opts, [...stack, snippet.id], lockedPath ?? path);
  }

  if (isParamRef(node)) {
    throw new ParamRefError(node.$param);
  }

  if (!isComponentNode(node)) {
    // Unreachable: schema union is exhausted above.
    throw new Error(`buildTree: unknown node shape: ${JSON.stringify(node)}`);
  }

  if (!isKnownComponent(node.$ref)) throw new UnknownComponentError(node.$ref);
  const Component = registry[node.$ref];
  if (!Component) throw new UnknownComponentError(node.$ref);

  const { children: childrenProp, ...restProps } = (node.props ?? {}) as Record<string, unknown>;
  const dataNodePath = (lockedPath ?? path).join(".");

  let children: ReactNode;
  if (Array.isArray(node.children) && node.children.length > 0) {
    children = node.children.map((child, i) =>
      buildTree(child, [...path, i], opts, stack, lockedPath),
    );
  } else if (childrenProp !== undefined) {
    children = childrenProp as ReactNode;
  }

  return createElement(
    Component,
    { ...restProps, "data-node-path": dataNodePath, key: dataNodePath || "root" },
    children,
  );
}

/**
 * Wrap the tree root in a Fragment so consumers can render it directly.
 */
export function buildRoot(node: Node, opts: BuildTreeOptions = {}): ReactElement {
  return createElement(Fragment, null, buildTree(node, [], opts));
}
