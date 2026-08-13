import { Hono } from "hono";
import type { DesignFolder } from "../design-folder.ts";

export function createBoardRouter(folder: () => DesignFolder): Hono {
  const r = new Hono();

  r.get("/", (c) => {
    return c.json(folder().board);
  });

  return r;
}
