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
 * Schema-level validation accepts all three at every Node position. Page
 * trees are expected to contain only `ComponentNode | SnippetInstance`;
 * `ParamRef`s in a page tree fail at substitution time rather than at
 * parse time so the schema stays simple.
 */
export type ComponentNode = {
  $ref: string;
  props?: Record<string, unknown>;
  children?: Node[];
};

export type SnippetInstance = {
  $snippet: string;
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

const ComponentNodeSchema: z.ZodType<ComponentNode> = z.lazy(() =>
  z.object({
    $ref: z.string().min(1),
    props: z.record(z.string(), z.unknown()).optional(),
    children: z.array(NodeSchema).optional(),
  }),
);

const SnippetInstanceSchema: z.ZodType<SnippetInstance> = z.object({
  $snippet: z.string().min(1),
  args: z.record(z.string(), z.unknown()).optional(),
});

const ParamRefSchema: z.ZodType<ParamRef> = z.object({
  $param: z.string().min(1),
});

export const NodeSchema: z.ZodType<Node> = z.lazy(() =>
  z.union([ComponentNodeSchema, SnippetInstanceSchema, ParamRefSchema]),
);

export { ComponentNodeSchema, ParamRefSchema, SnippetInstanceSchema };
