import { Hono } from "hono";
import { auditSnippet, darkModeAudit, inspect, type MutationContext } from "../mutations/index.ts";
import { pathFromString } from "../path.ts";
import { mutationToHttp } from "./mutation-http.ts";

export function createInspectRouter(ctxFor: () => MutationContext): Hono {
  const r = new Hono();

  // GET /api/inspect/dark-diff/:screenId
  r.get("/dark-diff/:screenId", async (c) => {
    const screenId = c.req.param("screenId");
    const result = await darkModeAudit(ctxFor(), { screenId });
    return result.ok ? c.json(result.value) : mutationToHttp(c, result.error);
  });

  // GET /api/inspect/dark-diff-snippet/:snippetId
  r.get("/dark-diff-snippet/:snippetId", async (c) => {
    const snippetId = c.req.param("snippetId");
    const result = await auditSnippet(ctxFor(), { snippetId });
    return result.ok ? c.json(result.value) : mutationToHttp(c, result.error);
  });

  // GET /api/inspect/:screenId/:path (path = dot-encoded; "" for root)
  r.get("/:screenId/:path{.*}?", async (c) => {
    const screenId = c.req.param("screenId");
    const rawPath = c.req.param("path") ?? "";
    const result = await inspect(ctxFor(), {
      screenId,
      path: pathFromString(rawPath),
    });
    return result.ok ? c.json(result.value) : mutationToHttp(c, result.error);
  });

  return r;
}
