import { map } from "@velloo/result";
import { Hono } from "hono";
import { z } from "zod";
import {
  applyPreset,
  derivePaletteFromColor,
  PRESET_NAMES,
  PRESETS,
  scoreThemeContrast,
  setToken,
  setTypeset,
  type ThemeContext,
} from "../theme/index.ts";
import { makeThemeRoute } from "./route.ts";

const SetTokenBody = z.object({
  path: z.string().min(1),
  value: z.union([z.string(), z.number()]),
});

const ApplyPresetBody = z.object({
  presetName: z.string().min(1),
});

const DeriveFromColorBody = z.object({
  seedColor: z.string().min(1),
  name: z.string().min(1).optional(),
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

export function createThemeRouter(ctxFor: () => ThemeContext): Hono {
  const r = new Hono();
  const route = makeThemeRoute(ctxFor);

  r.get("/", (c) => c.json(ctxFor().folder.theme));
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
            (t.colors.primary as { DEFAULT?: string })?.DEFAULT ?? (t.colors.primary as string),
          accent: (t.colors.accent as { DEFAULT?: string })?.DEFAULT ?? (t.colors.accent as string),
          foreground: t.colors.foreground,
        },
      };
    }).filter((x): x is NonNullable<typeof x> => x !== null);
    return c.json({ presets: summaries });
  });
  r.get("/contrast", (c) => c.json({ results: scoreThemeContrast(ctxFor().folder.theme) }));

  r.post(
    "/set_token",
    route(SetTokenBody, async (args, ctx) =>
      map(await setToken(ctx, args.path, args.value), (theme) => ({ theme })),
    ),
  );

  r.post(
    "/apply_preset",
    route(ApplyPresetBody, async (args, ctx) =>
      map(await applyPreset(ctx, args.presetName), (theme) => ({ theme })),
    ),
  );

  r.post(
    "/set_typeset",
    route(SetTypesetBody, async (args, ctx) =>
      map(await setTypeset(ctx, args.typesets, args.theme), (theme) => ({ theme })),
    ),
  );

  r.post(
    "/derive_palette_from_color",
    route(DeriveFromColorBody, (args, ctx) =>
      derivePaletteFromColor(ctx, args.seedColor, args.name),
    ),
  );

  return r;
}
