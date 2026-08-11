import { z } from "zod";
import { VariantSchema } from "./variant.ts";

export const PageSchema = z.object({
  name: z.string().min(1),
  variants: z.array(VariantSchema).min(1),
});

export type Page = z.infer<typeof PageSchema>;
