import {
  type ArtDirectionPageOption,
  BuildArtDirectionBodySchema,
  GenerateArtDirectionBodySchema,
  UpdateArtDirectionBodySchema,
} from "@velloo/protocol";
import { listCaptures } from "@velloo/renderer";
import { Hono } from "hono";
import { z } from "zod";
import {
  artDirectionState,
  buildArtDirection,
  createArtDirection,
  deleteArtDirection,
  generateArtDirection,
  listArtDirections,
  removeArtDirectionImage,
  updateArtDirection,
} from "../art-direction/art-direction.ts";
import type { CloudAuth } from "../cloud.ts";
import { describeGenerateFailure, fetchImageModels } from "../cloud-generate.ts";
import { hostRootOf } from "../mcp/restricted-jsx.ts";
import type { MutationContext } from "../mutations/index.ts";
import { makeRoute } from "./route.ts";

/** The app's routes, read by the CLI's route scanner (the server can't import it). */
export type AppRoutes = (appRoot: string) => Promise<{ routePath: string; file: string }[]>;

const MAX_ROUTES = 80;
const MAX_CAPTURES = 20;

/**
 * The canvas's art direction stage: read the art direction, edit it (drop a direction,
 * pick mood boards, choose a mock), draw images, and start over. The same operations the agent runs through `update_art_direction` and
 * `generate_art_direction`, so a person and an agent edit it the same way.
 */
export function createArtDirectionRouter(
  ctxFor: () => MutationContext,
  cloud?: CloudAuth,
  appRoutes?: AppRoutes,
): Hono {
  const r = new Hono();
  const route = makeRoute(ctxFor);

  r.get("/", async (c) => c.json({ artDirections: await listArtDirections(ctxFor().folder.root) }));

  r.get("/state", async (c) => {
    const state = await artDirectionState(ctxFor().folder.root, c.req.query("id") ?? "");
    return state ? c.json(state) : c.json({ error: "There's no such art direction." }, 404);
  });

  /** The pages the start page offers to redesign: routes, captured pages, screens. */
  r.get("/pages", async (c) => {
    const ctx = ctxFor();
    const folder = ctx.folder;
    const pages: ArtDirectionPageOption[] = [];
    const appRoot = hostRootOf(ctx);
    const routes = appRoutes ? await appRoutes(appRoot).catch(() => []) : [];
    for (const route of routes.slice(0, MAX_ROUTES)) {
      pages.push({
        kind: "route",
        page: { label: route.routePath, route: route.routePath, file: route.file },
        detail: route.file,
      });
    }
    const captures = listCaptures(folder.root, folder.config.folderId).filter((m) => !m.themeOnly);
    for (const capture of captures.slice(0, MAX_CAPTURES)) {
      pages.push({
        kind: "capture",
        page: { label: capture.title || capture.url, captureId: capture.id },
        detail: capture.url,
      });
    }
    for (const screen of folder.screens.values()) {
      pages.push({ kind: "screen", page: { label: screen.name, screenId: screen.id } });
    }
    return c.json({ pages });
  });

  /** The image models with live prices; null while the daemon isn't signed in. */
  r.get("/models", async (c) => {
    if (!cloud?.url) {
      return c.json({ models: null, signedOut: true, problem: "Not signed in to velloo-cloud." });
    }
    const models = await fetchImageModels(cloud);
    if (models.ok) return c.json({ models: models.value });
    return c.json({
      models: null,
      signedOut: models.error.kind === "LoggedOut",
      problem:
        models.error.kind === "HttpFailure" && models.error.status === 404
          ? "This velloo-cloud doesn't offer image models yet."
          : describeGenerateFailure(models.error),
    });
  });

  const withId = { id: z.string().min(1).max(80) };
  r.post(
    "/create",
    route(
      UpdateArtDirectionBodySchema.pick({ origin: true, page: true, name: true }),
      (args, ctx) => createArtDirection(ctx, args),
    ),
  );
  r.post(
    "/update",
    route(UpdateArtDirectionBodySchema.extend(withId), ({ id, ...args }, ctx) =>
      updateArtDirection(ctx, id, args),
    ),
  );
  r.post(
    "/generate",
    route(GenerateArtDirectionBodySchema.extend(withId), ({ id, ...args }, ctx) =>
      generateArtDirection(ctx, cloud, id, args),
    ),
  );
  r.post(
    "/build",
    route(BuildArtDirectionBodySchema.extend(withId), ({ id, ...args }, ctx) =>
      buildArtDirection(ctx, id, args),
    ),
  );
  r.post(
    "/delete",
    route(z.object(withId), ({ id }, ctx) => deleteArtDirection(ctx, id)),
  );
  r.post(
    "/remove-image",
    route(z.object({ ...withId, path: z.string().min(1) }), ({ id, path }, ctx) =>
      removeArtDirectionImage(ctx, id, path),
    ),
  );
  return r;
}
