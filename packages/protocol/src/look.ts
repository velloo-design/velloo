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
    .describe("Its theme's name; default \"default\" (with fromSketchbook, the direction's title)"),
  description: z.string().max(300).optional(),
  imagery: z
    .string()
    .max(2000)
    .optional()
    .describe("How its pictures are drawn; image generation reads it"),
  rules: z
    .object({
      dos: z.array(z.string().min(1)).max(20).optional(),
      donts: z.array(z.string().min(1)).max(20).optional(),
    })
    .optional()
    .describe("Each list given replaces the saved one"),
  images: z.array(LookImageSchema).max(24).optional().describe("Upserted by path, a folder asset"),
  removeImages: z.array(z.string()).optional(),
  references: z
    .array(LookReferenceSchema.extend({ path: z.string().min(1) }))
    .max(12)
    .optional()
    .describe(
      "Screenshots it draws on, upserted by path, with the `url` and a `note` of what to take",
    ),
  removeReferences: z.array(z.string()).optional(),
  fromSketchbook: LookSourceSchema.extend({
    from: z.string().min(1).optional(),
  })
    .optional()
    .describe(
      "Make the Look from a sketchbook direction: a copy of theme `from` (default: default) with the direction's images and references",
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
