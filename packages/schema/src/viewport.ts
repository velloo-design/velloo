import { z } from "zod";

export const ViewportSchema = z.object({
  w: z.number().int().positive(),
  h: z.number().int().positive(),
});

export type Viewport = z.infer<typeof ViewportSchema>;
