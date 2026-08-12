import { snapshotVersion } from "@velloo/shadcn-snapshot";
import { Hono } from "hono";
import type { DesignFolder } from "../design-folder.ts";

export function createDesignRouter(folder: () => DesignFolder): Hono {
  const r = new Hono();

  r.get("/", (c) => {
    const f = folder();
    return c.json({
      snapshotVersion,
      theme: { name: f.theme.name },
      defaultPage: f.config.defaultPage ?? null,
      pages: [...f.pages.entries()].map(([id, page]) => ({
        id,
        name: page.name,
        variants: page.variants.map((v) => ({
          id: v.id,
          name: v.name,
          viewport: v.viewport,
        })),
      })),
    });
  });

  return r;
}
