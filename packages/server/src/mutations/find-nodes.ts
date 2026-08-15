import { ok, type Result } from "@velloo/result";
import { isComponentNode, isSnippetInstance, type Node, nodeId } from "@velloo/schema";
import type { MutationContext } from "./context.ts";
import type { MutationError } from "./errors.ts";
import { getScreen } from "./lookup.ts";

/**
 * Read-only tree query. Agents repeatedly need "where is the Chart on
 * this screen" / "every Icon whose name is X" before they can call
 * update_props — without this they re-fetch the whole tree and walk it
 * themselves. Filters AND together.
 */
export interface FindNodesArgs {
  screenId: string;
  /** Exact `$ref` (component id) match. */
  ref?: string;
  /** Exact `$snippet` (snippet instance) match. */
  snippetId?: string;
  /** Exact `$id` match. */
  id?: string;
  /** Substring match on `props.className`. */
  classContains?: string;
  /** Prop key that must be present (e.g. "name"). */
  prop?: string;
  /** With `prop`: the value must also strictly equal this. */
  propValue?: unknown;
  /** Max matches returned. Default 50. */
  limit?: number;
}

export interface FoundNode {
  path: number[];
  kind: "component" | "snippet" | "param";
  /** `$ref` for components, `$snippet` for snippet instances. */
  ref?: string;
  id?: string;
  className?: string;
  /** First 80 chars of a string `children` prop, when present. */
  textPreview?: string;
  childCount: number;
}

export interface FindNodesResult {
  matches: FoundNode[];
  /** Total matches before `limit` was applied. */
  total: number;
}

function summarize(node: Node, path: number[]): FoundNode {
  if (isComponentNode(node)) {
    const props = node.props ?? {};
    const children = props.children;
    return {
      path,
      kind: "component",
      ref: node.$ref,
      ...(nodeId(node) ? { id: nodeId(node) } : {}),
      ...(typeof props.className === "string" ? { className: props.className } : {}),
      ...(typeof children === "string" ? { textPreview: children.slice(0, 80) } : {}),
      childCount: node.children?.length ?? 0,
    };
  }
  if (isSnippetInstance(node)) {
    return {
      path,
      kind: "snippet",
      ref: node.$snippet,
      ...(nodeId(node) ? { id: nodeId(node) } : {}),
      childCount: 0,
    };
  }
  return { path, kind: "param", childCount: 0 };
}

export async function findNodes(
  ctx: MutationContext,
  args: FindNodesArgs,
): Promise<Result<FindNodesResult, MutationError>> {
  const screenR = getScreen(ctx, args.screenId);
  if (!screenR.ok) return screenR;
  const limit = args.limit ?? 50;

  const matches: FoundNode[] = [];
  let total = 0;

  function consider(node: Node, path: number[]): void {
    const props = isComponentNode(node) ? (node.props ?? {}) : {};
    if (args.ref !== undefined && (!isComponentNode(node) || node.$ref !== args.ref)) return;
    if (
      args.snippetId !== undefined &&
      (!isSnippetInstance(node) || node.$snippet !== args.snippetId)
    ) {
      return;
    }
    if (args.id !== undefined && nodeId(node) !== args.id) return;
    if (args.classContains !== undefined) {
      const cls = props.className;
      if (typeof cls !== "string" || !cls.includes(args.classContains)) return;
    }
    if (args.prop !== undefined) {
      if (!(args.prop in props)) return;
      if (args.propValue !== undefined && props[args.prop] !== args.propValue) return;
    }
    total += 1;
    if (matches.length < limit) matches.push(summarize(node, path));
  }

  function walk(node: Node, path: number[]): void {
    consider(node, path);
    if (isComponentNode(node) && node.children) {
      node.children.forEach((child, i) => {
        walk(child, [...path, i]);
      });
    }
  }

  walk(screenR.value.tree, []);
  return ok({ matches, total });
}
