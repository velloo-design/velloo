import { map } from "@velloo/result";
import { Hono } from "hono";
import {
  applyPreset,
  derivePaletteFromColor,
  matchImage,
  matchVibe,
  PRESET_NAMES,
  setToken,
  type ThemeContext,
} from "../theme/index.ts";
import { makeThemeRoute } from "./route.ts";
import {
  ApplyPresetBody,
  DeriveFromColorBody,
  MatchImageBody,
  MatchVibeBody,
  SetTokenBody,
} from "./theme-schemas.ts";

export function createThemeRouter(ctxFor: () => ThemeContext): Hono {
  const r = new Hono();
  const route = makeThemeRoute(ctxFor);

  r.get("/", (c) => c.json(ctxFor().folder.theme));
  r.get("/presets", (c) => c.json({ presets: PRESET_NAMES }));

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
    "/derive_palette_from_color",
    route(DeriveFromColorBody, (args, ctx) =>
      derivePaletteFromColor(ctx, args.seedColor, args.name),
    ),
  );

  r.post(
    "/match_vibe",
    route(MatchVibeBody, (args, ctx) => matchVibe(ctx, args.description, { useAi: args.useAi })),
  );

  r.post(
    "/match_image",
    route(MatchImageBody, (args, ctx) => matchImage(ctx, args.imagePath)),
  );

  return r;
}
