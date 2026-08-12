import { z } from "zod";

const NumOrCssLen = z.union([z.number(), z.string().min(1)]);

/** Loose schema for user-extension token namespaces (`shadows`, future fields). */
const LooseTokenGroupSchema: z.ZodType<LooseTokenGroup> = z.lazy(() =>
  z.record(z.string(), z.union([z.string(), z.number(), LooseTokenGroupSchema])),
);
type LooseTokenGroup = { [key: string]: string | number | LooseTokenGroup };

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

/**
 * Structured typography slots — what Velloo's codegen + renderer actually
 * read. Each sub-shape is .passthrough()-equivalent (extra keys allowed)
 * via z.record at the leaf, so callers can add custom sizes without
 * breaking validation.
 */
export const TypographySchema = z.object({
  fontFamily: z
    .object({
      sans: z.string().min(1).optional(),
      mono: z.string().min(1).optional(),
      serif: z.string().min(1).optional(),
    })
    .partial()
    .optional(),
  fontSize: z.record(z.string(), NumOrCssLen).optional(),
  fontWeight: z.record(z.string(), NumOrCssLen).optional(),
  lineHeight: z.record(z.string(), NumOrCssLen).optional(),
  letterSpacing: z.record(z.string(), NumOrCssLen).optional(),
});

export type Typography = z.infer<typeof TypographySchema>;

/**
 * Structured radius slots. `md` is what emit_theme picks up as `--radius`.
 * Additional named sizes go into the record without losing the named ones.
 */
export const RadiusSchema = z
  .object({
    none: NumOrCssLen.optional(),
    sm: NumOrCssLen.optional(),
    md: NumOrCssLen.optional(),
    lg: NumOrCssLen.optional(),
    xl: NumOrCssLen.optional(),
    "2xl": NumOrCssLen.optional(),
    "3xl": NumOrCssLen.optional(),
    full: NumOrCssLen.optional(),
  })
  .partial();

export type Radius = z.infer<typeof RadiusSchema>;

export const ThemeSchema = z.object({
  name: z.string().min(1),
  colors: ColorsSchema,
  /** Dark-mode overrides — only the color slots that differ from `colors`.
   *  When present, emit_theme writes a `.dark { ... }` block and the canvas
   *  can preview both modes. Tokens missing here fall back to `colors`. */
  colorsDark: ColorsSchema.partial().optional(),
  typography: TypographySchema,
  spacing: LooseTokenGroupSchema,
  radius: RadiusSchema,
  shadows: LooseTokenGroupSchema.optional(),
});

export type Theme = z.infer<typeof ThemeSchema>;
