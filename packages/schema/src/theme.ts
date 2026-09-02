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
 * Numeric color scales + extra semantic roles captured verbatim from a host
 * app — `primary-600`, `success-500`, `danger`, `border-primary-300`. Keyed by
 * the Tailwind color name (no `--color-` prefix), values are CSS colors.
 * Emitted as `--color-<name>` so `bg-<name>` / `text-<name>` / `border-<name>`
 * resolve literally during a code-to-design port, instead of silently falling
 * back to the default palette.
 *
 * Distinct from `colors`: those are the semantic single-token slots that
 * theme-flip and drive the component snapshot; `palette` is a raw passthrough
 * for an app's own scale so verbatim classes render. Keys are constrained to a
 * CSS-safe ident so they can't inject into the emitted stylesheet.
 */
const PaletteSchema = z.record(
  z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/),
  z.string().min(1),
);

/**
 * A typeset: three rhythm controls plus font roles. Everything visible —
 * the h1..h6 ladder, body/lead/small copy, the space under a heading — derives
 * from these through `TYPESET_RATIOS` (see `./typeset.ts`), which is why there
 * is no size/weight/leading/tracking scale here to keep in sync.
 */
const TypesetSchema = z.object({
  /** Base text size. `1em` (the default) follows the surrounding container. */
  size: NumOrCssLen.optional(),
  /** Body line-height, unitless. Heading leading derives from it. */
  leading: z.number().positive().optional(),
  /** Vertical space between blocks. Heading margins and rule spacing derive from it. */
  flow: NumOrCssLen.optional(),
  /** A `fontFamily` role name for body copy, e.g. "sans". */
  fontBody: z.string().min(1).optional(),
  /** A `fontFamily` role name for headings, e.g. "display". */
  fontHeading: z.string().min(1).optional(),
  /** A `fontFamily` role name for code. */
  fontMono: z.string().min(1).optional(),
});

/**
 * Typography: font roles, webfont loading, and the folder's typesets.
 *
 * `.strict()` on purpose. This shape once carried `fontSize` / `fontWeight` /
 * `lineHeight` / `letterSpacing` records that no renderer, importer, or codegen
 * path ever read — tokens you could set and that silently did nothing. Typesets
 * replaced them, and strict validation means an attempt to write the old scale
 * fails loudly instead of being quietly dropped.
 */
export const TypographySchema = z
  .object({
    /**
     * Font stacks keyed by role. `sans` / `mono` / `serif` are the
     * conventional roles, but any key works — `display: '"Unbounded",
     * sans-serif'` becomes `--font-display`, which Tailwind v4 turns into
     * a `font-display` utility. Roles are the lever for typographic
     * personality: declare one per voice, not one per screen.
     */
    fontFamily: z.record(z.string(), z.string().min(1)).optional(),
    /**
     * Google Fonts css2 family specs to load in design mode and emit as
     * an @import in generated globals.css. Full spec syntax, e.g.
     * "Unbounded:wght@400..900" or "Fraunces:ital,wght@0,300..900".
     * Set via the `set_fonts` MCP tool rather than by hand.
     */
    googleFonts: z.array(z.string().min(1)).optional(),
    /**
     * Named typesets. `default` is the folder baseline and projects onto
     * `:root`, so it styles every screen; every other name becomes a
     * `.typeset-<name>` preset class a Prose region can opt into. Keys are
     * constrained to a CSS-safe ident because they are emitted as selectors.
     * Set via the `set_typeset` MCP tool.
     */
    typesets: z.record(z.string().regex(/^[A-Za-z0-9_-]+$/), TypesetSchema).optional(),
  })
  .strict();

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

/**
 * The host app's Tailwind `container` settings, captured so `class="container"`
 * centers / pads / caps the same way it does in the app. Tailwind's stock
 * `.container` does none of this (v4 dropped the `center`/`padding` options), so
 * a code-to-design port's gutters drift until these are honored. Emitted as a
 * `.container` override (render) / `@utility container` (codegen).
 */
export const ContainerSchema = z.object({
  center: z.boolean().optional(),
  /** Horizontal padding, e.g. "1.5rem". */
  padding: z.string().min(1).optional(),
  /** Largest max-width cap, e.g. "1320px". */
  maxWidth: z.string().min(1).optional(),
});

export const ThemeSchema = z.object({
  name: z.string().min(1),
  colors: ColorsSchema,
  /** Dark-mode overrides — only the color slots that differ from `colors`.
   *  When present, emit_theme writes a `.dark { ... }` block and the canvas
   *  can preview both modes. Tokens missing here fall back to `colors`. */
  colorsDark: ColorsSchema.partial().optional(),
  /** Numeric scales + extra roles captured from a host app (see PaletteSchema).
   *  Light values; dark overrides go in `paletteDark`. Optional — themes
   *  without an imported app palette omit it. */
  palette: PaletteSchema.optional(),
  paletteDark: PaletteSchema.optional(),
  typography: TypographySchema,
  spacing: LooseTokenGroupSchema,
  radius: RadiusSchema,
  shadows: LooseTokenGroupSchema.optional(),
  /** Host app's Tailwind container config — see ContainerSchema. */
  container: ContainerSchema.optional(),
  /**
   * `@keyframes` captured from a host app's `tailwind.config`:
   * name → selector ("0%" / "from") → CSS declarations. Paired with
   * `animation` so the app's `animate-<name>` utilities render on the canvas.
   */
  keyframes: z
    .record(z.string(), z.record(z.string(), z.record(z.string(), z.string())))
    .optional(),
  /** Animation shorthands keyed by utility name → `--animate-<name>` (e.g. `"fade-in": "fadeIn .3s ease-out"`). */
  animation: z.record(z.string(), z.string()).optional(),
});

export type Theme = z.infer<typeof ThemeSchema>;
