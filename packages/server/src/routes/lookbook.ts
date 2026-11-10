import {
  GenerateLookbookBodySchema,
  LookbookRequestBodySchema,
  UpdateLookbookBodySchema,
} from "@velloo/protocol";
import { Hono } from "hono";
import { z } from "zod";
import type { CloudAuth } from "../cloud.ts";
import { describeGenerateFailure, fetchImageModels } from "../cloud-generate.ts";
import {
  addLookbookRequest,
  generateLookbook,
  lookbookState,
  removeLookbookImage,
  updateLookbook,
} from "../lookbook/lookbook.ts";
import type { MutationContext } from "../mutations/index.ts";
import { makeRoute } from "./route.ts";

/**
 * The canvas's lookbook stage: read the lookbook, edit it (drop a direction,
 * pick mood boards, choose a mock), draw images, and leave a request for the
 * agent. The same operations the agent runs through `update_lookbook` and
 * `generate_lookbook`, so a person and an agent edit it the same way.
 */
export function createLookbookRouter(ctxFor: () => MutationContext, cloud?: CloudAuth): Hono {
  const r = new Hono();
  const route = makeRoute(ctxFor);

  r.get("/", async (c) => c.json(await lookbookState(ctxFor().folder.root)));

  /** The image models with live prices; null while the daemon isn't signed in. */
  r.get("/models", async (c) => {
    if (!cloud?.url) return c.json({ models: null, problem: "Not signed in to velloo-cloud." });
    const models = await fetchImageModels(cloud);
    return c.json(
      models.ok
        ? { models: models.value }
        : { models: null, problem: describeGenerateFailure(models.error) },
    );
  });

  r.post(
    "/update",
    route(UpdateLookbookBodySchema, (args, ctx) => updateLookbook(ctx, args)),
  );
  r.post(
    "/generate",
    route(GenerateLookbookBodySchema, (args, ctx) => generateLookbook(ctx, cloud, args)),
  );
  r.post(
    "/request",
    route(LookbookRequestBodySchema, (args, ctx) => addLookbookRequest(ctx, args)),
  );
  r.post(
    "/remove-image",
    route(z.object({ path: z.string().min(1) }), (args, ctx) =>
      removeLookbookImage(ctx, args.path),
    ),
  );
  return r;
}
