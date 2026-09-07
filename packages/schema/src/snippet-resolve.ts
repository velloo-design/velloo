import { isComponentNode, isParamRef, isSnippetInstance, type Node } from "./node.ts";
import type { Snippet } from "./snippet.ts";

/**
 * Pure snippet-body resolution helpers shared by the renderer (render
 * time) and codegen (inlining instances that carry `$overrides`). No
 * throwing — callers wrap missing-param reports in their own error
 * vocabulary (renderer throws SnippetParamError, codegen returns a
 * CodegenError).
 */

/**
 * An optional param supplied no value and no default — resolves to "nothing".
 * A node slot bearing it is dropped (renders/emits nothing); a prop bearing it
 * is omitted. Internal sentinel: never appears in a persisted tree.
 */
const OMITTED: unique symbol = Symbol("velloo.omitted-optional-param");

/** Substitution result for an OMITTED value — pruned from arrays and prop objects. */
const DROP: unique symbol = Symbol("velloo.drop");

/** Resolve declared params against passed args, applying defaults. */
export function resolveSnippetArgs(
  snippet: Snippet,
  passed: Record<string, unknown>,
): { args: Record<string, unknown>; missing: string[] } {
  const args: Record<string, unknown> = {};
  const missing: string[] = [];
  for (const param of snippet.params) {
    if (param.name in passed) {
      args[param.name] = passed[param.name];
    } else if (param.default !== undefined) {
      args[param.name] = param.default;
    } else if (param.optional) {
      args[param.name] = OMITTED;
    } else {
      missing.push(param.name);
    }
  }
  return { args, missing };
}

function isTruthy(v: unknown): boolean {
  if (v === undefined || v === null || v === OMITTED) return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0 && !Number.isNaN(v);
  if (typeof v === "string") return v !== "";
  return true;
}

/** A `$param` that substituted to a scalar where a child node was expected. */
export interface InvalidParamPlacement {
  param: string;
  /** typeof the resolved value (or "null") — for a precise error message. */
  valueType: string;
}

/**
 * Recursively rewrite snippet body values:
 * - `{ $param: "name" }` → `args.name`
 * - `{ $if: "name", then, else }` → branch by truthiness
 * - `{ $if: "name", eq, then, else }` → branch by strict equality
 * Unknown param names are collected in `missing` (the offending
 * substitution resolves to undefined) rather than thrown.
 *
 * `invalid` collects scalar params dropped into a *node* position — a
 * component node's own `children` array, where only subtrees render. This
 * is the classic mis-wire (a `string` param used as a child instead of as
 * a prop value); flagging it lets the renderer name the param and point at
 * the fix instead of failing opaquely deep in React. A `children` *prop*
 * value (`props.children`) is plain content, not a node position, so a
 * scalar param there is correct and never flagged.
 */
export function substituteSnippetParams(
  value: unknown,
  args: Record<string, unknown>,
): { value: unknown; missing: string[]; invalid: InvalidParamPlacement[] } {
  const missing: string[] = [];
  const invalid: InvalidParamPlacement[] = [];
  function walk(v: unknown, inNodePosition: boolean): unknown {
    if (v === null || typeof v !== "object") return v;
    if (Array.isArray(v)) {
      // Prune DROP holes so an omitted optional `node` slot leaves no gap.
      return v.map((item) => walk(item, inNodePosition)).filter((item) => item !== DROP);
    }
    if (typeof (v as { $param?: unknown }).$param === "string") {
      const name = (v as { $param: string }).$param;
      if (!(name in args)) {
        missing.push(name);
        return undefined;
      }
      const resolved = args[name];
      // An omitted optional param resolves to nothing — never a mis-wire.
      if (resolved === OMITTED) return DROP;
      if (inNodePosition && (resolved === null || typeof resolved !== "object")) {
        invalid.push({ param: name, valueType: resolved === null ? "null" : typeof resolved });
        return undefined;
      }
      return resolved;
    }
    if (typeof (v as { $if?: unknown }).$if === "string") {
      const cond = v as { $if: string; eq?: unknown; then?: unknown; else?: unknown };
      if (!(cond.$if in args)) {
        missing.push(cond.$if);
        return undefined;
      }
      const matched = "eq" in cond ? args[cond.$if] === cond.eq : isTruthy(args[cond.$if]);
      return walk(matched ? cond.then : cond.else, inNodePosition);
    }
    // Only a component node's own `children` array carries node positions.
    const isComponentNodeObj = typeof (v as { $ref?: unknown }).$ref === "string";
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) {
      const w = walk(val, isComponentNodeObj && k === "children");
      // A prop resolving to an omitted optional param is left off entirely.
      if (w !== DROP) out[k] = w;
    }
    return out;
  }
  return { value: walk(value, false), missing, invalid };
}

/** Depth-first search for a `$id`-bearing component node inside a body. */
function findNodeById(root: Node, id: string): Node | undefined {
  if (!isComponentNode(root)) return undefined;
  if (root.$id === id) return root;
  for (const child of root.children ?? []) {
    const hit = findNodeById(child, id);
    if (hit) return hit;
  }
  return undefined;
}

/**
 * Apply per-instance interior prop patches (`SnippetInstance.$overrides`)
 * to a resolved body. Keys address the substituted tree either as dotted
 * index paths ("0.2") or as "@id" references to `$id`-bearing body nodes
 * — ids survive definition restructures, so prefer them when the body
 * declares ids. A key that no longer resolves (definition changed since
 * the override was written) is skipped silently — stale overrides
 * degrade to "no effect".
 */
export function applySnippetOverrides(
  body: Node,
  overrides: Record<string, { props: Record<string, unknown> }>,
): Node {
  const clone = structuredClone(body);
  for (const [key, patch] of Object.entries(overrides)) {
    let target: Node | undefined;
    if (key.startsWith("@")) {
      target = findNodeById(clone, key.slice(1));
    } else {
      const segments = key === "" ? [] : key.split(".").map(Number);
      target = clone;
      for (const i of segments) {
        if (!target || !isComponentNode(target) || !target.children) {
          target = undefined;
          break;
        }
        target = target.children[i];
      }
    }
    if (!target || !isComponentNode(target)) continue;
    const props = { ...(target.props ?? {}) };
    for (const [k, v] of Object.entries(patch.props)) {
      if (v === null) delete props[k];
      else props[k] = v;
    }
    target.props = props;
  }
  return clone;
}

/**
 * Merge an instance's `$extraClassName` onto a resolved body's root.
 * Snippet-of-snippet roots forward the extra to the inner instance;
 * param-ref roots can't carry a className and pass through unchanged.
 */
export function applySnippetExtraClassName(node: Node, extra: string): Node {
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
