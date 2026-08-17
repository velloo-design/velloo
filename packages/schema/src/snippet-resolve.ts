import { isComponentNode, isParamRef, isSnippetInstance, type Node } from "./node.ts";
import type { Snippet } from "./snippet.ts";

/**
 * Pure snippet-body resolution helpers shared by the renderer (render
 * time) and codegen (inlining instances that carry `$overrides`). No
 * throwing — callers wrap missing-param reports in their own error
 * vocabulary (renderer throws SnippetParamError, codegen returns a
 * CodegenError).
 */

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
    } else {
      missing.push(param.name);
    }
  }
  return { args, missing };
}

function isTruthy(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0 && !Number.isNaN(v);
  if (typeof v === "string") return v !== "";
  return true;
}

/**
 * Recursively rewrite snippet body values:
 * - `{ $param: "name" }` → `args.name`
 * - `{ $if: "name", then, else }` → branch by truthiness
 * - `{ $if: "name", eq, then, else }` → branch by strict equality
 * Unknown param names are collected in `missing` (the offending
 * substitution resolves to undefined) rather than thrown.
 */
export function substituteSnippetParams(
  value: unknown,
  args: Record<string, unknown>,
): { value: unknown; missing: string[] } {
  const missing: string[] = [];
  function walk(v: unknown): unknown {
    if (v === null || typeof v !== "object") return v;
    if (Array.isArray(v)) return v.map(walk);
    if (typeof (v as { $param?: unknown }).$param === "string") {
      const name = (v as { $param: string }).$param;
      if (!(name in args)) {
        missing.push(name);
        return undefined;
      }
      return args[name];
    }
    if (typeof (v as { $if?: unknown }).$if === "string") {
      const cond = v as { $if: string; eq?: unknown; then?: unknown; else?: unknown };
      if (!(cond.$if in args)) {
        missing.push(cond.$if);
        return undefined;
      }
      const matched = "eq" in cond ? args[cond.$if] === cond.eq : isTruthy(args[cond.$if]);
      return walk(matched ? cond.then : cond.else);
    }
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) out[k] = walk(val);
    return out;
  }
  return { value: walk(value), missing };
}

/**
 * Apply per-instance interior prop patches (`SnippetInstance.$overrides`)
 * to a resolved body. Paths address the substituted tree; a path that no
 * longer resolves (definition changed since the override was written)
 * is skipped silently — stale overrides degrade to "no effect".
 */
export function applySnippetOverrides(
  body: Node,
  overrides: Record<string, { props: Record<string, unknown> }>,
): Node {
  const clone = structuredClone(body);
  for (const [relPath, patch] of Object.entries(overrides)) {
    const segments = relPath === "" ? [] : relPath.split(".").map(Number);
    let target: Node | undefined = clone;
    for (const i of segments) {
      if (!target || !isComponentNode(target) || !target.children) {
        target = undefined;
        break;
      }
      target = target.children[i];
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
