import { Hono } from "hono";
import {
  addAnnotation,
  type MutationContext,
  removeAnnotation,
  updateAnnotation,
} from "../mutations/index.ts";
import { resolveLocator } from "../path.ts";
import { AddAnnotationBody, RemoveAnnotationBody, UpdateAnnotationBody } from "./mutate-schemas.ts";
import { makeRoute } from "./route.ts";

/**
 * Canvas-facing CRUD for annotations. Annotations live in per-page sidecar
 * files (`pages/<id>.annotations.json`); the MCP surface only reads them.
 */
export function createAnnotationsRouter(ctxFor: () => MutationContext): Hono {
  const r = new Hono();
  const route = makeRoute(ctxFor);

  // GET /api/annotations/:pageId — list annotations for a page with their
  // resolved paths (null when the target can't be resolved on the current
  // variant tree, i.e. the annotation is dangling).
  r.get("/:pageId", (c) => {
    const ctx = ctxFor();
    const pageId = c.req.param("pageId");
    const page = ctx.folder.pages.get(pageId);
    const annotations = ctx.folder.annotations.get(pageId) ?? [];
    const list = annotations.map((a) => {
      let resolved: number[] | null = null;
      if (page) {
        const variant = page.variants.find((v) => v.id === a.target.variantId);
        if (variant) resolved = resolveLocator(variant.tree, a.target.locator);
      }
      return { ...a, resolved };
    });
    return c.json({ annotations: list });
  });

  r.post(
    "/add",
    route(AddAnnotationBody, (a, ctx) => addAnnotation(ctx, a)),
  );
  r.post(
    "/update",
    route(UpdateAnnotationBody, (a, ctx) => updateAnnotation(ctx, a)),
  );
  r.post(
    "/remove",
    route(RemoveAnnotationBody, (a, ctx) => removeAnnotation(ctx, a)),
  );

  return r;
}
