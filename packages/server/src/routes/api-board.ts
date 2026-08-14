import { Hono } from "hono";
import type { DesignFolder } from "../design-folder.ts";

/**
 * GET /api/board/:id — return one board's full JSON.
 *
 * The boards list comes through /api/design (top-level summary).
 */
export function createBoardRouter(folder: () => DesignFolder): Hono {
  const r = new Hono();

  r.get("/:id", (c) => {
    const f = folder();
    const board = f.boards.get(c.req.param("id"));
    if (!board) return c.json({ error: "board not found" }, 404);
    return c.json(board);
  });

  return r;
}
