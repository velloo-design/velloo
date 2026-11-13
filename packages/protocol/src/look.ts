import { type Look, LookImageSchema, LookReferenceSchema, LookSourceSchema } from "@velloo/schema";
import { z } from "zod";

/**
 * The Look's wire contract: one write, shared by the canvas (`/api/looks`) and
 * the agent (`update_look`), so the two can't drift into editing a Look
 * differently. A Look's tokens stay theme writes (`set_theme`).
 */
export const UpdateLookBodySchema = z.object({
  theme: z
    .string()
    .min(1)
    .optional()
    .describe(
      "The Look (its theme's name); default \"default\". With fromSketchbook, the new Look's name (default: the direction's title).",
    ),
  description: z.string().max(300).optional().describe("The Look in one line."),
  imagery: z
    .string()
    .max(2000)
    .optional()
    .describe("How its photographs and illustrations are drawn; image generation reads it."),
  rules: z
    .object({
      dos: z.array(z.string().min(1)).max(20).optional(),
      donts: z.array(z.string().min(1)).max(20).optional(),
    })
    .optional()
    .describe("Each list given replaces the saved one."),
  images: z
    .array(LookImageSchema)
    .max(24)
    .optional()
    .describe("Added, or updated by path. Paths are folder-relative assets."),
  removeImages: z.array(z.string()).optional().describe("Paths to take out."),
  references: z
    .array(LookReferenceSchema.extend({ path: z.string().min(1) }))
    .max(12)
    .optional()
    .describe(
      "Screenshots it refers to, added or updated by path (an asset; a sketchbook's references are under assets/sketchbook/<id>/refs/), with the `url` it shows and a `note` of what to take.",
    ),
  removeReferences: z.array(z.string()).optional().describe("Reference paths to take out."),
  fromSketchbook: LookSourceSchema.extend({
    from: z.string().min(1).optional(),
  })
    .optional()
    .describe(
      "Make a Look from a sketchbook direction: its theme (a copy of `from`, default the default theme), its mood board and mocks as images, and its references. Sketchbook id + direction id.",
    ),
});
export type UpdateLookBody = z.infer<typeof UpdateLookBodySchema>;

/** One Look as the Looks rail lists it: its sidecar (null for a plain Look) and enough to draw a swatch. */
export interface LookSummary {
  name: string;
  look: Look | null;
  /** The boards that render with it. */
  usedByBoards: string[];
  /** Background, primary and accent, light: the swatch a Look without images is shown with. */
  swatch: string[];
}
