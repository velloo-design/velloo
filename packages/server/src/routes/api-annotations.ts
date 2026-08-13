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
 * Canvas-facing CRUD for annotations. Annotations live in per-screen sidecar
 * files (`screens/<id>.annotations.json`); the MCP surface only reads them.
 */
export function createAnnotationsRouter(ctxFor: () => MutationContext): Hono {
  const r = new Hono();
  const route = makeRoute(ctxFor);

  // GET /api/annotations/:screenId — list annotations for a screen with their
  // resolved paths (null when the target can't be resolved on the screen tree).
  r.get("/:screenId", (c) => {
    const ctx = ctxFor();
    const screenId = c.req.param("screenId");
    const screen = ctx.folder.screens.get(screenId);
    const annotations = ctx.folder.annotations.get(screenId) ?? [];
    const list = annotations.map((a) => {
      const resolved = screen ? resolveLocator(screen.tree, a.target.locator) : null;
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
