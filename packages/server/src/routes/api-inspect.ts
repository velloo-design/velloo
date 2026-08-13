import { Hono } from "hono";
import { darkModeAudit, inspect, type MutationContext } from "../mutations/index.ts";
import { pathFromString } from "../path.ts";
import { mutationToHttp } from "./mutation-http.ts";

export function createInspectRouter(ctxFor: () => MutationContext): Hono {
  const r = new Hono();

  // GET /api/inspect/dark-diff/:pageId/:variantId  (must come before the catch-all below)
  r.get("/dark-diff/:pageId/:variantId", async (c) => {
    const pageId = c.req.param("pageId");
    const variantId = c.req.param("variantId");
    const result = await darkModeAudit(ctxFor(), { pageId, variantId });
    return result.ok ? c.json(result.value) : mutationToHttp(c, result.error);
  });

  // GET /api/inspect/:pageId/:variantId/:path  (path = dot-encoded; "" for root)
  r.get("/:pageId/:variantId/:path{.*}?", async (c) => {
    const pageId = c.req.param("pageId");
    const variantId = c.req.param("variantId");
    const rawPath = c.req.param("path") ?? "";
    const result = await inspect(ctxFor(), {
      pageId,
      variantId,
      path: pathFromString(rawPath),
    });
    return result.ok ? c.json(result.value) : mutationToHttp(c, result.error);
  });

  return r;
}
