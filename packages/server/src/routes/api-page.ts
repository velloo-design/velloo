import { Hono } from "hono";
import type { DesignFolder } from "../design-folder.ts";

export function createPageRouter(folder: () => DesignFolder): Hono {
  const r = new Hono();

  r.get("/:id", (c) => {
    const f = folder();
    const page = f.pages.get(c.req.param("id"));
    if (!page) return c.json({ error: "page not found" }, 404);
    return c.json(page);
  });

  return r;
}
