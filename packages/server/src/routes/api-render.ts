import { renderScreen, UnknownComponentError } from "@velloo/renderer";
import type { Viewport } from "@velloo/schema";
import { Hono } from "hono";
import type { DesignFolder } from "../design-folder.ts";
import type { TailwindJit } from "../styles/tailwind-jit.ts";

/**
 * Render a screen as standalone HTML. The viewport size for responsive Tailwind
 * comes from query params (?w=...&h=...) — defaults to the first viewport
 * preset if missing. Used by the canvas to mount a screen inside each frame
 * iframe at the frame's current size.
 */
export function createRenderRouter(folder: () => DesignFolder, jit: TailwindJit): Hono {
  const r = new Hono();

  r.get("/:screenId", async (c) => {
    const f = folder();
    const screen = f.screens.get(c.req.param("screenId"));
    if (!screen) return c.json({ error: "screen not found" }, 404);

    const preset = f.config.viewportPresets[0] ?? { name: "default", w: 1440, h: 900 };
    const w = Number(c.req.query("w")) || preset.w;
    const h = Number(c.req.query("h")) || preset.h;
    const viewport: Viewport = { w, h };

    try {
      const dark = c.req.query("mode") === "dark";
      const snapshotCss = await jit.build();
      const { html } = await renderScreen(screen, f.theme, {
        viewport,
        snapshotCss,
        snippets: f.snippets,
        dark,
      });
      return c.body(html, 200, { "Content-Type": "text/html; charset=utf-8" });
    } catch (err) {
      if (err instanceof UnknownComponentError) {
        return c.json({ error: err.message, ref: err.ref }, 422);
      }
      throw err;
    }
  });

  return r;
}
