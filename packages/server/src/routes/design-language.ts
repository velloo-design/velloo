import { $, DoAsync, map } from "@velloo/result";
import { ThemeSchema } from "@velloo/schema";
import { Hono } from "hono";
import { z } from "zod";
import { readDesignRules, restoreDesignRules, writeDesignRules } from "../design-rules.ts";
import type { MutationContext, MutationError } from "../mutations/index.ts";
import { restoreTheme } from "../theme/index.ts";
import { makeRoute } from "./route.ts";

const RulesBody = z.object({
  intent: z.string(),
  rules: z.array(z.object({ kind: z.enum(["do", "dont"]), text: z.string().min(1) })),
});

/**
 * What the canvas held when the stage was opened, sent back on Cancel. `rules`
 * is null when the design followed no document then, and absent when its rules
 * are a repo file the stage could not have changed.
 */
const RestoreBody = z.object({
  theme: ThemeSchema,
  rules: RulesBody.nullable().optional(),
});

/**
 * The canvas's design-language stage: the rules in words, and undoing a visit
 * to it. The tokens themselves go through `/api/theme`, like every other theme
 * edit, and the specimen is a render (`/api/render/specimen`), not a resource.
 */
export function createDesignLanguageRouter(ctxFor: () => MutationContext): Hono {
  const r = new Hono();
  const route = makeRoute(ctxFor);

  r.get("/", async (c) => c.json({ rules: await readDesignRules(ctxFor().folder) }));

  r.post(
    "/rules",
    route(RulesBody, async (args, ctx) =>
      map(await writeDesignRules(ctx, args), (rules) => ({ rules })),
    ),
  );

  r.post(
    "/restore",
    route(RestoreBody, (args, ctx) =>
      DoAsync<object, MutationError>(async function* () {
        await restoreTheme(ctx, args.theme);
        if (args.rules === undefined) return { rules: await readDesignRules(ctx.folder) };
        return { rules: yield* $(await restoreDesignRules(ctx, args.rules)) };
      }),
    ),
  );

  return r;
}
