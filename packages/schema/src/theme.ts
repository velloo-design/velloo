import { z } from "zod";

const TokenLeafSchema = z.union([z.string(), z.number()]);
const TokenGroupSchema: z.ZodType<TokenGroup> = z.lazy(() =>
  z.record(z.string(), z.union([TokenLeafSchema, TokenGroupSchema])),
);

type TokenGroup = { [key: string]: string | number | TokenGroup };

/**
 * A color slot is either a single CSS color or a pair { DEFAULT, foreground }.
 * Matches shadcn's CSS-variable convention (e.g. --primary, --primary-foreground).
 */
const ColorPairSchema = z.union([
  z.string().min(1),
  z.object({
    DEFAULT: z.string().min(1),
    foreground: z.string().min(1).optional(),
  }),
]);

export type ColorPair = z.infer<typeof ColorPairSchema>;

/**
 * Typed color slots. `background`, `foreground`, and `primary` are required —
 * everything else is optional so existing themes don't regress.
 */
export const ColorsSchema = z.object({
  background: z.string().min(1),
  foreground: z.string().min(1),
  primary: ColorPairSchema,
  secondary: ColorPairSchema.optional(),
  muted: ColorPairSchema.optional(),
  accent: ColorPairSchema.optional(),
  destructive: ColorPairSchema.optional(),
  card: ColorPairSchema.optional(),
  popover: ColorPairSchema.optional(),
  border: z.string().min(1).optional(),
  input: z.string().min(1).optional(),
  ring: z.string().min(1).optional(),
});

export type Colors = z.infer<typeof ColorsSchema>;

export const ThemeSchema = z.object({
  name: z.string().min(1),
  colors: ColorsSchema,
  typography: TokenGroupSchema,
  spacing: TokenGroupSchema,
  radius: TokenGroupSchema,
  shadows: TokenGroupSchema.optional(),
});

export type Theme = z.infer<typeof ThemeSchema>;
