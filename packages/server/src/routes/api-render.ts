import { renderScreen, UnknownComponentError } from "@velloo/renderer";
import type { Screen, Viewport } from "@velloo/schema";
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

  /**
   * Render a snippet in isolation as live HTML. Wraps the snippet in a
   * synthetic single-node screen (mirroring how the MCP render_snippet
   * tool works) so the same renderer code path handles both. Defaults
   * fill required params with placeholder strings — the agent can
   * always override via ?arg.<name>=<value> in a future iteration.
   */
  r.get("/snippet/:snippetId", async (c) => {
    const f = folder();
    const snippet = f.snippets.get(c.req.param("snippetId"));
    if (!snippet) return c.json({ error: "snippet not found" }, 404);

    const w = Number(c.req.query("w")) || 480;
    const h = Number(c.req.query("h")) || 320;
    const viewport: Viewport = { w, h };

    /**
     * Fill required params (no default) with friendly placeholders so
     * the thumbnail never crashes the renderer. Optional params get
     * their declared defaults via the snippet body's `$param` lookup.
     */
    const args: Record<string, unknown> = {};
    for (const p of snippet.params) {
      if (p.default !== undefined) continue;
      if (p.type === "string") args[p.name] = p.name;
      else if (p.type === "number") args[p.name] = 0;
      else if (p.type === "boolean") args[p.name] = false;
      else if (p.type === "node") args[p.name] = { $ref: "Text", props: { children: p.name } };
    }

    const screen: Screen = {
      id: `${snippet.id}__preview`,
      name: `${snippet.name} preview`,
      tree: {
        $snippet: snippet.id,
        ...(Object.keys(args).length > 0 ? { args } : {}),
      },
    };

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
