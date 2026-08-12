import { renderVariant, UnknownComponentError } from "@velloo/renderer";
import { Hono } from "hono";
import type { DesignFolder } from "../design-folder.ts";
import type { TailwindJit } from "../styles/tailwind-jit.ts";

export function createRenderRouter(folder: () => DesignFolder, jit: TailwindJit): Hono {
  const r = new Hono();

  r.get("/:pageId/:variantId", async (c) => {
    const f = folder();
    const page = f.pages.get(c.req.param("pageId"));
    if (!page) return c.json({ error: "page not found" }, 404);

    const variant = page.variants.find((v) => v.id === c.req.param("variantId"));
    if (!variant) return c.json({ error: "variant not found" }, 404);

    try {
      const dark = c.req.query("mode") === "dark";
      const snapshotCss = await jit.build();
      const { html } = await renderVariant(variant, f.theme, { snapshotCss, dark });
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
