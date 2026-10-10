import { map } from "@velloo/result";
import { Hono } from "hono";
import { z } from "zod";
import { themeByName } from "../design-folder.ts";
import {
  addTheme,
  applyPreset,
  applyStartingPoint,
  derivePaletteFromColor,
  matchingStartingPoint,
  PRESET_NAMES,
  PRESETS,
  STARTING_POINTS,
  scoreThemeContrast,
  setCustomRole,
  setFonts,
  setRadius,
  setToken,
  setTokens,
  setTypeset,
  type ThemeContext,
} from "../theme/index.ts";
import { makeThemeRoute } from "./route.ts";

/**
 * Every write carries the theme it targets, because a board can pin its own
 * (`Board.theme`) and the canvas edits whatever the board on screen renders
 * with. Omitted means the folder default.
 */
const SetTokenBody = z.object({
  path: z.string().min(1),
  value: z.union([z.string(), z.number()]),
  theme: z.string().min(1).optional(),
});

const ApplyPresetBody = z.object({
  presetName: z.string().min(1),
  theme: z.string().min(1).optional(),
});

const ApplyStartingPointBody = z.object({
  id: z.string().min(1),
  theme: z.string().min(1).optional(),
});

const SetTokensBody = z.object({
  entries: z
    .array(z.object({ path: z.string().min(1), value: z.union([z.string(), z.number()]) }))
    .min(1),
  theme: z.string().min(1).optional(),
});

const SetRadiusBody = z.object({
  value: z.union([z.string().min(1), z.number()]),
  theme: z.string().min(1).optional(),
});

/** A colour role of the design's own. `remove` drops it, light and dark together. */
const SetRoleBody = z.object({
  name: z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/, "lowercase kebab-case, letter first"),
  light: z.string().min(1).optional(),
  dark: z.string().min(1).optional(),
  remove: z.boolean().optional(),
  theme: z.string().min(1).optional(),
});

const DeriveFromColorBody = z.object({
  seedColor: z.string().min(1),
  name: z.string().min(1).optional(),
});

const AddThemeBody = z.object({
  name: z.string().min(1),
  /** Theme to clone. Omitted clones the folder default. */
  from: z.string().min(1).optional(),
});

/**
 * Mirrors the `set_typeset` MCP tool's spec shape. `null` clears a control back
 * to inherited — which is the canvas's "return to default" affordance, so the
 * nullable unions are load-bearing rather than decorative.
 */
const TypesetSpecBody = z.object({
  name: z.string().min(1).optional(),
  renameTo: z.string().min(1).optional(),
  remove: z.boolean().optional(),
  size: z.union([z.string(), z.number(), z.null()]).optional(),
  leading: z.union([z.number(), z.null()]).optional(),
  flow: z.union([z.string(), z.number(), z.null()]).optional(),
  fontBody: z.union([z.string(), z.null()]).optional(),
  fontHeading: z.union([z.string(), z.null()]).optional(),
  fontMono: z.union([z.string(), z.null()]).optional(),
});

const SetTypesetBody = z.object({
  typesets: z.array(TypesetSpecBody).min(1),
  theme: z.string().min(1).optional(),
});

/** Mirrors the `set_fonts` MCP tool. `family` is absent only when removing. */
const FontSpecBody = z.object({
  role: z.string().min(1),
  family: z.string().min(1).optional(),
  fallback: z.string().min(1).optional(),
  google: z.union([z.string().min(1), z.literal(true)]).optional(),
  remove: z.boolean().optional(),
});

const SetFontsBody = z.object({
  fonts: z.array(FontSpecBody).min(1),
  theme: z.string().min(1).optional(),
});

export function createThemeRouter(ctxFor: () => ThemeContext): Hono {
  const r = new Hono();
  const route = makeThemeRoute(ctxFor);

  // `?name=` so the panel can read the theme the board on screen renders with,
  // rather than always the folder default. An unknown name falls back to the
  // default the same way the render route does.
  r.get("/", (c) => c.json(themeByName(ctxFor().folder, c.req.query("name"))));
  r.get("/presets", (c) => c.json({ presets: PRESET_NAMES }));
  /**
   * Returns each preset's name plus a short list of swatch colors the
   * canvas previews in the gallery grid. Cheap to compute (the preset
   * table is in-memory) so we don't bother caching.
   */
  r.get("/preset-summaries", (c) => {
    const summaries = PRESET_NAMES.map((name) => {
      const t = PRESETS[name];
      if (!t) return null;
      return {
        name,
        swatches: {
          background: t.colors.background,
          primary:
            (t.colors.primary as { DEFAULT?: string | undefined })?.DEFAULT ??
            (t.colors.primary as string),
          accent:
            (t.colors.accent as { DEFAULT?: string | undefined })?.DEFAULT ??
            (t.colors.accent as string),
          foreground: t.colors.foreground,
        },
      };
    }).filter((x): x is NonNullable<typeof x> => x !== null);
    return c.json({ presets: summaries });
  });
  // What the design-language stage offers to start from: name, what it
  // borrows, and enough to draw it without applying it.
  r.get("/starting-points", (c) =>
    c.json({
      startingPoints: STARTING_POINTS.map((p) => ({
        id: p.id,
        name: p.name,
        note: p.note,
        primary: p.primary,
        font: p.fonts.display ?? p.fonts.sans,
        radius: p.radius,
      })),
      // The one this theme still exactly is — null once any part it set has
      // been changed, so a card is never lit for a theme it no longer describes.
      active: matchingStartingPoint(themeByName(ctxFor().folder, c.req.query("name"))),
    }),
  );
  r.get("/contrast", (c) =>
    c.json({ results: scoreThemeContrast(themeByName(ctxFor().folder, c.req.query("name"))) }),
  );

  r.post(
    "/set_token",
    route(SetTokenBody, async (args, ctx) =>
      map(await setToken(ctx, args.path, args.value, args.theme), (theme) => ({ theme })),
    ),
  );

  r.post(
    "/apply_preset",
    route(ApplyPresetBody, async (args, ctx) =>
      map(await applyPreset(ctx, args.presetName, args.theme), (theme) => ({ theme })),
    ),
  );

  r.post(
    "/apply_starting_point",
    route(ApplyStartingPointBody, async (args, ctx) =>
      map(await applyStartingPoint(ctx, args.id, args.theme), (theme) => ({ theme })),
    ),
  );

  // Several tokens in one write — a dark pair needs its colour and its text
  // colour to land together, or the theme is invalid in between.
  r.post(
    "/set_tokens",
    route(SetTokensBody, async (args, ctx) =>
      map(await setTokens(ctx, args.entries, args.theme), ({ theme }) => ({ theme })),
    ),
  );

  r.post(
    "/set_radius",
    route(SetRadiusBody, async (args, ctx) =>
      map(await setRadius(ctx, args.value, args.theme), (theme) => ({ theme })),
    ),
  );

  r.post(
    "/set_role",
    route(SetRoleBody, async ({ theme: themeName, ...role }, ctx) =>
      map(await setCustomRole(ctx, role, themeName), (theme) => ({ theme })),
    ),
  );

  r.post(
    "/set_typeset",
    route(SetTypesetBody, async (args, ctx) =>
      map(await setTypeset(ctx, args.typesets, args.theme), (theme) => ({ theme })),
    ),
  );

  r.post(
    "/set_fonts",
    route(SetFontsBody, async (args, ctx) =>
      map(await setFonts(ctx, args.fonts, args.theme), (theme) => ({ theme })),
    ),
  );

  // Mirrors the `add_theme` MCP tool. The theme switcher needs it so trying a
  // variant on one board doesn't mean editing the theme its siblings share.
  r.post(
    "/add_theme",
    route(AddThemeBody, (args, ctx) => addTheme(ctx, args.name, args.from)),
  );

  r.post(
    "/derive_palette_from_color",
    route(DeriveFromColorBody, (args, ctx) =>
      derivePaletteFromColor(ctx, args.seedColor, args.name),
    ),
  );

  return r;
}
