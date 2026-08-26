import type { ComponentNode } from "@velloo/schema";

/** If `value` is a `$param`/`$if` substitution, describe it; else null. */
function dynamicRefName(value: unknown): string | null {
  if (value === null || typeof value !== "object") return null;
  const v = value as { $param?: unknown; $if?: unknown };
  if (typeof v.$param === "string") return `param "${v.$param}"`;
  if (typeof v.$if === "string") return `$if on "${v.$if}"`;
  return null;
}

/**
 * An Icon whose `name` is a `$param`/`$if` substitution can't survive
 * lowering: the lucide name becomes the JSX tag, which must be a static
 * identifier, so every instance would emit the same fallback glyph. Returns
 * the substitution's description (`param "x"` / `$if on "x"`) for such a
 * node, else null. Shared by the emit-time warning (tree-to-jsx) and the
 * server's design-time snippet check.
 */
export function dynamicIconName(node: ComponentNode): string | null {
  if (node.$ref !== "Icon") return null;
  return dynamicRefName(node.props?.name);
}
