import {
  BuildSketchbookBodySchema,
  GenerateSketchbookBodySchema,
  type SketchbookPageOption,
  UpdateSketchbookBodySchema,
} from "@velloo/protocol";
import { listCaptures } from "@velloo/renderer";
import { Hono } from "hono";
import { z } from "zod";
import type { CloudAuth } from "../cloud.ts";
import { describeGenerateFailure, fetchImageModels } from "../cloud-generate.ts";
import { hostRootOf } from "../mcp/restricted-jsx.ts";
import type { MutationContext } from "../mutations/index.ts";
import { sketchbookLinks } from "../sketchbook/links.ts";
import {
  buildSketchbook,
  createSketchbook,
  deleteSketchbook,
  generateSketchbook,
  listSketchbooks,
  readSketchbooks,
  removeSketchbookImage,
  sketchbookState,
  updateSketchbook,
} from "../sketchbook/sketchbook.ts";
import { makeRoute } from "./route.ts";

/** The app's routes, read by the CLI's route scanner (the server can't import it). */
export type AppRoutes = (appRoot: string) => Promise<{ routePath: string; file: string }[]>;

const MAX_ROUTES = 80;
const MAX_CAPTURES = 20;

/**
 * The canvas's sketchbook stage: read the sketchbook, edit it (drop a direction,
 * pick mood boards, choose a mock), draw images, and start over. The same operations the agent runs through `update_sketchbook` and
 * `generate_sketchbook`, so a person and an agent edit it the same way.
 */
export function createSketchbookRouter(
  ctxFor: () => MutationContext,
  cloud?: CloudAuth,
  appRoutes?: AppRoutes,
): Hono {
  const r = new Hono();
  const route = makeRoute(ctxFor);

  r.get("/", async (c) => c.json({ sketchbooks: await listSketchbooks(ctxFor().folder.root) }));

  /** What each screen and board came from, for the board chip and the stale marks. */
  r.get("/links", async (c) => {
    const ctx = ctxFor();
    return c.json(sketchbookLinks(await readSketchbooks(ctx.folder.root), ctx.folder));
  });

  r.get("/state", async (c) => {
    const state = await sketchbookState(ctxFor().folder.root, c.req.query("id") ?? "");
    return state ? c.json(state) : c.json({ error: "There's no such sketchbook." }, 404);
  });

  /** The pages the start page offers to redesign: routes, captured pages, screens. */
  r.get("/pages", async (c) => {
    const ctx = ctxFor();
    const folder = ctx.folder;
    const pages: SketchbookPageOption[] = [];
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
    route(UpdateSketchbookBodySchema.pick({ origin: true, page: true, name: true }), (args, ctx) =>
      createSketchbook(ctx, args),
    ),
  );
  r.post(
    "/update",
    route(UpdateSketchbookBodySchema.extend(withId), ({ id, ...args }, ctx) =>
      updateSketchbook(ctx, id, args),
    ),
  );
  r.post(
    "/generate",
    route(GenerateSketchbookBodySchema.extend(withId), ({ id, ...args }, ctx) =>
      generateSketchbook(ctx, cloud, id, args),
    ),
  );
  r.post(
    "/build",
    route(BuildSketchbookBodySchema.extend(withId), ({ id, ...args }, ctx) =>
      buildSketchbook(ctx, id, args),
    ),
  );
  r.post(
    "/delete",
    route(z.object(withId), ({ id }, ctx) => deleteSketchbook(ctx, id)),
  );
  r.post(
    "/remove-image",
    route(z.object({ ...withId, path: z.string().min(1) }), ({ id, path }, ctx) =>
      removeSketchbookImage(ctx, id, path),
    ),
  );
  return r;
}
