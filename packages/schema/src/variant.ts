import { z } from "zod";
import { NodeSchema } from "./node.ts";

export const ViewportSchema = z.object({
  w: z.number().int().positive(),
  h: z.number().int().positive(),
});

export type Viewport = z.infer<typeof ViewportSchema>;

/**
 * Canvas position for a variant. When undefined, the canvas auto-flows
 * variants left-to-right. When set, the variant is placed at (x, y) in
 * the canvas's coordinate space.
 */
export const VariantPositionSchema = z.object({
  x: z.number(),
  y: z.number(),
});

export type VariantPosition = z.infer<typeof VariantPositionSchema>;

export const VariantSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  viewport: ViewportSchema,
  position: VariantPositionSchema.optional(),
  tree: NodeSchema,
});

export type Variant = z.infer<typeof VariantSchema>;
