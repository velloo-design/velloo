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
      defaultScreen: f.config.defaultScreen ?? null,
      screens: [...f.screens.entries()].map(([id, screen]) => ({
        id,
        name: screen.name,
      })),
      board: f.board,
      snippets: [...f.snippets.entries()].map(([id, snippet]) => ({
        id,
        name: snippet.name,
        params: snippet.params,
      })),
    });
  });

  return r;
}
