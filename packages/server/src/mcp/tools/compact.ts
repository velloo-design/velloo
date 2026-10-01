import { nodeShape } from "@velloo/schema";

/** Nodes in a tree, slot and rich-text props included; `$param` placeholders are not nodes. */
function countNodes(value: unknown): number {
  if (Array.isArray(value)) return value.reduce((sum: number, item) => sum + countNodes(item), 0);
  if (typeof value !== "object" || value === null) return 0;
  const shape = nodeShape(value);
  if (shape.kind === "param") return 0;
  const own = shape.kind === "invalid" ? 0 : 1;
  return own + Object.values(value).reduce((sum: number, v) => sum + countNodes(v), 0);
}

function withoutTree(resource: unknown): unknown {
  if (typeof resource !== "object" || resource === null || !("tree" in resource)) return resource;
  const { tree, ...rest } = resource as { tree: unknown } & Record<string, unknown>;
  return { ...rest, nodeCount: countNodes(tree) };
}

/**
 * A mutation's value with any whole screen or snippet it carries reduced to its
 * metadata and a node count. Echoing the tree back costs the agent the full
 * tree in context for nothing it asked for — cloning a large screen with
 * `fromScreenId` once returned 105k characters — and `get_screen` (outline
 * mode) is there when it does want to read it.
 */
export function compactMutationValue<T>(value: T): T {
  if (typeof value !== "object" || value === null) return value;
  const record = value as Record<string, unknown>;
  if (!("screen" in record) && !("snippet" in record)) return value;
  return {
    ...record,
    ...("screen" in record ? { screen: withoutTree(record.screen) } : {}),
    ...("snippet" in record ? { snippet: withoutTree(record.snippet) } : {}),
  } as T;
}
