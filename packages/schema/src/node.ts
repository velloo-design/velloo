import { z } from "zod";

/**
 * A node tree is a discriminated union over three shapes, distinguished by
 * which `$`-prefixed key is present:
 *
 * - `ComponentNode` — a real shadcn / velloo component (`{ $ref }`).
 * - `SnippetInstance` — an instantiation of a snippet defined in `snippets/`
 *   (`{ $snippet, args }`). From the page's POV the instance is opaque —
 *   path navigation stops at the instance; you can edit its args but not
 *   descend into the snippet body.
 * - `ParamRef` — `{ $param: name }`. Valid only inside a snippet body;
 *   substituted with the corresponding instance arg at render time. May
 *   appear as a child node OR anywhere inside a `props` value via the
 *   normal JSON walk during substitution.
 *
 * `ComponentNode` and `SnippetInstance` may carry an optional `$id` —
 * a stable anchor that survives sibling insertions and deletions. Ids
 * are unique within a single screen tree (validated at persist time).
 * Agents address `$id`-bearing nodes via the locator form `"@id"` in
 * place of a path array.
 *
 * Schema-level validation accepts all three at every Node position. Screen
 * trees are expected to contain only `ComponentNode | SnippetInstance`;
 * `ParamRef`s in a screen tree fail at substitution time rather than at
 * parse time so the schema stays simple.
 */
export type ComponentNode = {
  $ref: string;
  $id?: string;
  props?: Record<string, unknown>;
  children?: Node[];
};

export type SnippetInstance = {
  $snippet: string;
  $id?: string;
  /**
   * Extra Tailwind classes merged into the snippet body's root element at
   * render time. Lets one-off instances tweak styling (e.g. wider, accent
   * border) without forking the snippet definition. Pass it via
   * `instantiate_snippet({extraClassName})` or `update_snippet_args`.
   */
  $extraClassName?: string;
  args?: Record<string, unknown>;
};

export type ParamRef = {
  $param: string;
};

export type Node = ComponentNode | SnippetInstance | ParamRef;

export function isComponentNode(n: Node): n is ComponentNode {
  return typeof (n as { $ref?: unknown }).$ref === "string";
}

export function isSnippetInstance(n: Node): n is SnippetInstance {
  return typeof (n as { $snippet?: unknown }).$snippet === "string";
}

export function isParamRef(n: Node): n is ParamRef {
  return typeof (n as { $param?: unknown }).$param === "string";
}

/**
 * Format constraint for `$id` values. Must start with a letter; the rest
 * is letters / digits / dashes / underscores. Matches typical anchor
 * naming (`hero-cta`, `feature_card_3`, `nav`). The leading-letter rule
 * keeps ids from colliding with numeric path indices in the locator
 * parser if we ever support compound locators.
 */
export const NodeIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/, {
    message: "node id must match /^[a-zA-Z][a-zA-Z0-9_-]*$/",
  });

const ComponentNodeSchema: z.ZodType<ComponentNode> = z.lazy(() =>
  z.object({
    $ref: z.string().min(1),
    $id: NodeIdSchema.optional(),
    props: z.record(z.string(), z.unknown()).optional(),
    children: z.array(NodeSchema).optional(),
  }),
);

const SnippetInstanceSchema: z.ZodType<SnippetInstance> = z.object({
  $snippet: z.string().min(1),
  $id: NodeIdSchema.optional(),
  $extraClassName: z.string().optional(),
  args: z.record(z.string(), z.unknown()).optional(),
});

const ParamRefSchema: z.ZodType<ParamRef> = z.object({
  $param: z.string().min(1),
});

export const NodeSchema: z.ZodType<Node> = z.lazy(() =>
  z.union([ComponentNodeSchema, SnippetInstanceSchema, ParamRefSchema]),
);

export { ComponentNodeSchema, ParamRefSchema, SnippetInstanceSchema };

/**
 * Read the `$id` of a node, if any. Convenience wrapper so callers don't
 * have to narrow by node kind first.
 */
export function nodeId(n: Node): string | undefined {
  if (isParamRef(n)) return undefined;
  return (n as { $id?: string }).$id;
}
