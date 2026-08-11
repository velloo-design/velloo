import { z } from "zod";

const TokenLeafSchema = z.union([z.string(), z.number()]);
const TokenGroupSchema: z.ZodType<TokenGroup> = z.lazy(() =>
  z.record(z.string(), z.union([TokenLeafSchema, TokenGroupSchema])),
);

type TokenGroup = { [key: string]: string | number | TokenGroup };

export const ThemeSchema = z.object({
  name: z.string().min(1),
  colors: TokenGroupSchema,
  typography: TokenGroupSchema,
  spacing: TokenGroupSchema,
  radius: TokenGroupSchema,
  shadows: TokenGroupSchema.optional(),
});

export type Theme = z.infer<typeof ThemeSchema>;
