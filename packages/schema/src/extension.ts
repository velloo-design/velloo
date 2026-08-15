import { z } from "zod";

/**
 * A user-declared component the agent can place in a screen tree but
 * which isn't part of any library's registry. The canvas renders an
 * extension node as a labelled placeholder (Tier 1); codegen emits a
 * real import to `importPath` so the user's app mounts the actual
 * component. See `docs/decisions.md` #24 for the three-tier
 * customization story.
 *
 * The prop schema mirrors `@velloo/provider`'s `PropDescriptor` — kept
 * here as a Zod schema so `.design/config.json` validation works
 * without `@velloo/schema` depending on `@velloo/provider` (which
 * would invert the package graph). The type produced is structurally
 * compatible: extension props feed into the same inspector affordances
 * the manifest-derived ones use.
 */
export const PropControlSchema = z.enum(["boolean", "number", "string", "color", "enum", "icon"]);

export const ExtensionPropDescriptorSchema = z
  .object({
    name: z.string().min(1),
    /** Raw TS type string (e.g. "boolean | undefined"). Free-form; just used for display. */
    type: z.string().min(1),
    optional: z.boolean(),
    defaultValue: z.string().optional(),
    control: PropControlSchema,
    /** Allowed values when `control === "enum"`. */
    enumValues: z.array(z.union([z.string(), z.number()])).optional(),
  })
  .superRefine((prop, ctx) => {
    // An enum control with no values would render an empty select in the
    // inspector — reject it at parse time instead.
    if (prop.control === "enum" && (!prop.enumValues || prop.enumValues.length === 0)) {
      ctx.addIssue({
        code: "custom",
        path: ["enumValues"],
        message: `prop "${prop.name}": control "enum" requires a non-empty \`enumValues\` array`,
      });
    }
  });

export type ExtensionPropDescriptor = z.infer<typeof ExtensionPropDescriptorSchema>;

export const ExtensionSchema = z.object({
  /**
   * Bare import specifier emitted by codegen. Examples:
   *   "@/components/data-table"     — alias-based relative path
   *   "../components/PriceChart"    — relative path
   *   "@acme/charts"                — npm package
   */
  importPath: z.string().min(1),
  /**
   * UI vs typography. Drives the Library tab grouping; defaults to
   * "ui" when omitted.
   */
  category: z.enum(["ui", "typography"]).optional(),
  /** Free-form description shown in the Library detail page. */
  description: z.string().optional(),
  /** Schema of props the canvas inspector + agent both consume. */
  props: z.array(ExtensionPropDescriptorSchema),
  /**
   * Marks how the agent registered this extension. "agent" is the
   * common case (via `add_extension` MCP tool); "manual" indicates the
   * user edited config.json directly. Today purely informational —
   * affects nothing in code.
   */
  origin: z.enum(["agent", "manual"]).optional(),
});

export type Extension = z.infer<typeof ExtensionSchema>;
