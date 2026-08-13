import { Hono } from "hono";
import type { DesignFolder } from "../design-folder.ts";

export function createSnippetsRouter(folder: () => DesignFolder): Hono {
  const r = new Hono();

  r.get("/", (c) => {
    const f = folder();
    return c.json({
      snippets: [...f.snippets.entries()].map(([id, snippet]) => ({
        id,
        name: snippet.name,
        params: snippet.params,
      })),
    });
  });

  r.get("/:snippetId", (c) => {
    const f = folder();
    const snippet = f.snippets.get(c.req.param("snippetId"));
    if (!snippet) return c.json({ error: "snippet not found" }, 404);
    return c.json(snippet);
  });

  return r;
}
