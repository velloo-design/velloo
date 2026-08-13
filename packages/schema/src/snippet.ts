import { z } from "zod";
import { NodeSchema } from "./node.ts";

/**
 * A parameter declared by a snippet. The agent passes a matching arg value
 * at every instantiation; `default` is used when omitted.
 */
export const SnippetParamSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["string", "number", "boolean", "node"]),
  default: z.unknown().optional(),
});

export type SnippetParam = z.infer<typeof SnippetParamSchema>;

/**
 * A reusable subtree living in `design/snippets/<id>.json`. Parameter
 * placeholders inside `tree` are encoded as `{ $param: name }` and
 * substituted with the corresponding arg at render time.
 */
export const SnippetSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  params: z.array(SnippetParamSchema),
  tree: NodeSchema,
});

export type Snippet = z.infer<typeof SnippetSchema>;
