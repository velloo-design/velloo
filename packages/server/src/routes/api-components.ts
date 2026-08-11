import { loadManifest } from "@velloo/shadcn-snapshot";
import { Hono } from "hono";

let cached: unknown = null;

export function createComponentsRouter(): Hono {
  const r = new Hono();

  r.get("/", async (c) => {
    if (!cached) cached = await loadManifest();
    return c.json(cached);
  });

  return r;
}
