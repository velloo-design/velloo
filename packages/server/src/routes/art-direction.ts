import { GenerateArtDirectionBodySchema, UpdateArtDirectionBodySchema } from "@velloo/protocol";
import { Hono } from "hono";
import { z } from "zod";
import {
  artDirectionState,
  generateArtDirection,
  removeArtDirectionImage,
  resetArtDirection,
  updateArtDirection,
} from "../art-direction/art-direction.ts";
import type { CloudAuth } from "../cloud.ts";
import { describeGenerateFailure, fetchImageModels } from "../cloud-generate.ts";
import type { MutationContext } from "../mutations/index.ts";
import { makeRoute } from "./route.ts";

/**
 * The canvas's art direction stage: read the art direction, edit it (drop a direction,
 * pick mood boards, choose a mock), draw images, and start over. The same operations the agent runs through `update_art_direction` and
 * `generate_art_direction`, so a person and an agent edit it the same way.
 */
export function createArtDirectionRouter(ctxFor: () => MutationContext, cloud?: CloudAuth): Hono {
  const r = new Hono();
  const route = makeRoute(ctxFor);

  r.get("/", async (c) => c.json(await artDirectionState(ctxFor().folder.root)));

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

  r.post(
    "/update",
    route(UpdateArtDirectionBodySchema, (args, ctx) => updateArtDirection(ctx, args)),
  );
  r.post(
    "/generate",
    route(GenerateArtDirectionBodySchema, (args, ctx) => generateArtDirection(ctx, cloud, args)),
  );
  r.post(
    "/reset",
    route(z.object({}), (_args, ctx) => resetArtDirection(ctx)),
  );
  r.post(
    "/remove-image",
    route(z.object({ path: z.string().min(1) }), (args, ctx) =>
      removeArtDirectionImage(ctx, args.path),
    ),
  );
  return r;
}
