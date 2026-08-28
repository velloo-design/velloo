import { Hono } from "hono";
import type { DesignFolder } from "../design-folder.ts";
import { emptySearchResult, searchFolder } from "../search.ts";

/**
 * GET /api/search?q=…&limit=… — the canvas's Ctrl+K search. Read-only walk
 * over the in-memory folder; see search.ts for the matching rules.
 */
export function createSearchRouter(folder: () => DesignFolder): Hono {
  const r = new Hono();

  r.get("/", (c) => {
    const q = c.req.query("q") ?? "";
    const limitRaw = Number(c.req.query("limit") ?? "20");
    const limit = Number.isFinite(limitRaw) ? Math.min(100, Math.max(1, Math.floor(limitRaw))) : 20;
    if (q.trim() === "") return c.json(emptySearchResult(q));
    return c.json(searchFolder(folder(), q, limit));
  });

  return r;
}
