import { z } from "zod";
import { NodeSchema } from "./node.ts";

export const ViewportSchema = z.object({
  w: z.number().int().positive(),
  h: z.number().int().positive(),
});

export type Viewport = z.infer<typeof ViewportSchema>;

export const VariantSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  viewport: ViewportSchema,
  tree: NodeSchema,
});

export type Variant = z.infer<typeof VariantSchema>;
