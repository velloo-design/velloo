import { Hono } from "hono";
import type { DesignFolder } from "../design-folder.ts";

export function createScreenRouter(folder: () => DesignFolder): Hono {
  const r = new Hono();

  r.get("/:id", (c) => {
    const f = folder();
    const screen = f.screens.get(c.req.param("id"));
    if (!screen) return c.json({ error: "screen not found" }, 404);
    return c.json(screen);
  });

  return r;
}
