import type { Node } from "@velloo/schema";
import { isKnownComponent, registry } from "@velloo/shadcn-snapshot";
import { createElement, Fragment, type ReactElement, type ReactNode } from "react";

export class UnknownComponentError extends Error {
  constructor(public readonly ref: string) {
    super(`Unknown component $ref="${ref}". Not in @velloo/shadcn-snapshot registry.`);
    this.name = "UnknownComponentError";
  }
}

/**
 * Walk the design Node tree and produce a React element tree, resolving
 * each `$ref` against the bundled snapshot registry. Each rendered element
 * carries `data-node-path="i.j.k"` so the canvas iframe runtime can map
 * a clicked DOM element back to its position in the design tree.
 */
export function buildTree(node: Node, path: number[] = []): ReactElement {
  if (!isKnownComponent(node.$ref)) throw new UnknownComponentError(node.$ref);

  const Component = registry[node.$ref];
  if (!Component) throw new UnknownComponentError(node.$ref);

  const { children: childrenProp, ...restProps } = (node.props ?? {}) as Record<string, unknown>;
  const dataNodePath = path.join(".");

  let children: ReactNode;
  if (Array.isArray(node.children) && node.children.length > 0) {
    children = node.children.map((child, i) => buildTree(child, [...path, i]));
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
export function buildRoot(node: Node): ReactElement {
  return createElement(Fragment, null, buildTree(node, []));
}
