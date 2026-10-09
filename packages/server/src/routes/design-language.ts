import { map } from "@velloo/result";
import { Hono } from "hono";
import { z } from "zod";
import { readDesignRules, writeDesignRules } from "../design-rules.ts";
import type { MutationContext } from "../mutations/index.ts";
import { ensureSpecimen, SPECIMEN_ID } from "../specimen.ts";
import { makeRoute } from "./route.ts";

const RulesBody = z.object({
  intent: z.string(),
  rules: z.array(z.object({ kind: z.enum(["do", "dont"]), text: z.string().min(1) })),
});

const SpecimenBody = z.object({ rebuild: z.boolean().optional() });

/**
 * The canvas's design-language stage: the rules in words and the specimen
 * board. The tokens themselves go through `/api/theme`, like every other theme
 * edit — this router only adds what that one has no place for.
 */
export function createDesignLanguageRouter(ctxFor: () => MutationContext): Hono {
  const r = new Hono();
  const route = makeRoute(ctxFor);

  r.get("/", async (c) => {
    const { folder } = ctxFor();
    return c.json({
      rules: await readDesignRules(folder),
      specimen: folder.screens.has(SPECIMEN_ID)
        ? { screenId: SPECIMEN_ID, boardId: folder.boards.has(SPECIMEN_ID) ? SPECIMEN_ID : null }
        : null,
    });
  });

  r.post(
    "/rules",
    route(RulesBody, async (args, ctx) =>
      map(await writeDesignRules(ctx, args), (rules) => ({ rules })),
    ),
  );

  r.post(
    "/specimen",
    route(SpecimenBody, (args, ctx) => ensureSpecimen(ctx, { rebuild: args.rebuild })),
  );

  return r;
}
