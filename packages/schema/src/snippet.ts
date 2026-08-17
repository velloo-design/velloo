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
 *
 * `icon` is for ONE icon chosen at design time — `emit_code` bakes it into
 * the JSX as a literal `<Sparkles/>`. For an icon that varies per instance
 * (by status, priority, …), use a `node` param instead: it emits as a
 * `{slot}` the caller fills, where an `icon` param would collapse every
 * instance to the same glyph (a lucide name must be a literal JSX tag).
 */
export const SnippetParamSchema = z
  .object({
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
  })
  .superRefine((param, ctx) => {
    // Catch type/default mismatches at parse time — otherwise the canvas
    // inspector and render-time substitution each have to coerce bad data.
    if (param.type === "enum") {
      if (!param.enum || param.enum.length === 0) {
        ctx.addIssue({
          code: "custom",
          path: ["enum"],
          message: `param "${param.name}": type "enum" requires a non-empty \`enum\` array`,
        });
        return;
      }
      if (param.default !== undefined && !param.enum.includes(param.default as string)) {
        ctx.addIssue({
          code: "custom",
          path: ["default"],
          message: `param "${param.name}": default ${JSON.stringify(param.default)} is not one of the declared enum values`,
        });
      }
      return;
    }
    if (param.default === undefined || param.type === "node") return;
    const expected =
      param.type === "number" ? "number" : param.type === "boolean" ? "boolean" : "string";
    if (typeof param.default !== expected) {
      ctx.addIssue({
        code: "custom",
        path: ["default"],
        message: `param "${param.name}": default ${JSON.stringify(param.default)} does not match declared type "${param.type}"`,
      });
    }
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
