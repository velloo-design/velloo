import { z } from "zod";
import { NodeSchema } from "./node.ts";

/**
 * A parameter declared by a snippet. The agent passes a matching arg value
 * at every instantiation; `default` is used when omitted.
 *
 * `type` drives both validation and the inspector's UI:
 *   - "string" → text input
 *   - "number" → numeric input with step/min/max
 *   - "boolean" → checkbox
 *   - "icon" → lucide icon picker (string-valued)
 *   - "color" → color swatch + token-aware picker (string-valued)
 *   - "enum" → select with the declared `enum` values
 *   - "node" → subtree slot
 *
 * For `enum`, declare the allowed strings in `enum`; for `number`,
 * `min`/`max`/`step` shape the input.
 */
export const SnippetParamSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["string", "number", "boolean", "node", "icon", "color", "enum"]),
  default: z.unknown().optional(),
  /** Allowed values for `type: "enum"`. */
  enum: z.array(z.string()).optional(),
  /** Numeric constraints for `type: "number"`. */
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().optional(),
  /** Free-form description for the inspector tooltip. */
  description: z.string().optional(),
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
  /**
   * Library id (key in `Config.libraries`) this snippet's body
   * resolves against. Optional — when absent the folder's
   * `defaultLibrary` is used. Snippets are pinned to one library; an
   * instance placed in a screen using a different library renders
   * against the snippet's library, not the embedding screen's.
   */
  library: z.string().min(1).optional(),
  tree: NodeSchema,
});

export type Snippet = z.infer<typeof SnippetSchema>;
