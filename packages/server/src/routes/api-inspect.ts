import { Hono } from "hono";
import { inspect, type MutationContext, MutationError } from "../mutations/index.ts";
import { pathFromString } from "../path.ts";

export function createInspectRouter(ctxFor: () => MutationContext): Hono {
  const r = new Hono();

  // GET /api/inspect/:pageId/:variantId/:path  (path = dot-encoded; "" for root)
  r.get("/:pageId/:variantId/:path{.*}?", async (c) => {
    const pageId = c.req.param("pageId");
    const variantId = c.req.param("variantId");
    const rawPath = c.req.param("path") ?? "";
    try {
      const result = await inspect(ctxFor(), {
        pageId,
        variantId,
        path: pathFromString(rawPath),
      });
      return c.json(result);
    } catch (err) {
      if (err instanceof MutationError) return c.json({ error: err.payload }, 400);
      throw err;
    }
  });

  return r;
}
