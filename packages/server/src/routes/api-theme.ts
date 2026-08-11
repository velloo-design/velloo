import { Hono } from "hono";
import {
  applyPreset,
  derivePaletteFromColor,
  matchImage,
  matchVibe,
  PRESET_NAMES,
  setToken,
  type ThemeContext,
  ThemeError,
} from "../theme/index.ts";

function badRequest(reason: string) {
  return { error: { code: "BAD_REQUEST", message: reason } };
}

export function createThemeRouter(ctxFor: () => ThemeContext): Hono {
  const r = new Hono();

  r.get("/", (c) => c.json(ctxFor().folder.theme));

  r.get("/presets", (c) => c.json({ presets: PRESET_NAMES }));

  r.post("/set_token", async (c) => {
    const args = (await c.req.json()) as { path?: string; value?: string | number };
    if (!args.path || args.value === undefined) {
      return c.json(badRequest("path and value are required"), 400);
    }
    try {
      const theme = await setToken(ctxFor(), args.path, args.value);
      return c.json({ theme });
    } catch (err) {
      if (err instanceof ThemeError) return c.json({ error: err.payload }, 400);
      throw err;
    }
  });

  r.post("/apply_preset", async (c) => {
    const args = (await c.req.json()) as { presetName?: string };
    if (!args.presetName) return c.json(badRequest("presetName is required"), 400);
    try {
      const theme = await applyPreset(ctxFor(), args.presetName);
      return c.json({ theme });
    } catch (err) {
      if (err instanceof ThemeError) return c.json({ error: err.payload }, 400);
      throw err;
    }
  });

  r.post("/derive_palette_from_color", async (c) => {
    const args = (await c.req.json()) as { seedColor?: string; name?: string };
    if (!args.seedColor) return c.json(badRequest("seedColor is required"), 400);
    try {
      const result = await derivePaletteFromColor(ctxFor(), args.seedColor, args.name);
      return c.json(result);
    } catch (err) {
      if (err instanceof ThemeError) return c.json({ error: err.payload }, 400);
      throw err;
    }
  });

  r.post("/match_vibe", async (c) => {
    const args = (await c.req.json()) as { description?: string; useAi?: boolean };
    if (!args.description) return c.json(badRequest("description is required"), 400);
    try {
      const result = await matchVibe(ctxFor(), args.description, { useAi: args.useAi });
      return c.json(result);
    } catch (err) {
      if (err instanceof ThemeError) return c.json({ error: err.payload }, 400);
      throw err;
    }
  });

  r.post("/match_image", async (c) => {
    const args = (await c.req.json()) as { imagePath?: string };
    if (!args.imagePath) return c.json(badRequest("imagePath is required"), 400);
    try {
      const result = await matchImage(ctxFor(), args.imagePath);
      return c.json(result);
    } catch (err) {
      if (err instanceof ThemeError) return c.json({ error: err.payload }, 400);
      throw err;
    }
  });

  return r;
}
