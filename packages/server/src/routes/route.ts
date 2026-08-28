import type { Result } from "@velloo/result";
import type { Context } from "hono";
import type { z } from "zod";
import { withActor } from "../activity.ts";
import { type MutationError, badRequest as mutationBadRequest } from "../mutations/errors.ts";
import { type ThemeError, themeBadRequest } from "../theme/errors.ts";
import { mutationToHttp, themeToHttp } from "./error-http.ts";

async function readBody(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return undefined;
  }
}

/**
 * Build a per-route handler from a zod arg schema and a Result-returning
 * implementation. Validation failures become a BadRequest of the bound error
 * type and flow through the same `toHttp` mapping as every other variant —
 * one wire format across happy + sad paths.
 *
 *   const route = makeRoute(ctxFor);                // MutationError-flavored
 *   r.post("/add_node", route(AddNodeBody, (args, ctx) => addNode(ctx, args)));
 *
 *   const route = makeThemeRoute(ctxFor);           // ThemeError-flavored
 *   r.post("/set_token", route(SetTokenBody, (a, ctx) => setToken(ctx, a.path, a.value)));
 */
interface Bindings<E, Ctx> {
  ctxFor: () => Ctx;
  badRequest: (m: string, i?: unknown) => E;
  toHttp: (c: Context, e: E) => Response;
}

function makeBoundRoute<E, Ctx>(b: Bindings<E, Ctx>) {
  return function route<S extends z.ZodTypeAny, T>(
    schema: S,
    handler: (args: z.infer<S>, ctx: Ctx) => Promise<Result<T, E>>,
  ) {
    return async (c: Context): Promise<Response> => {
      const body = await readBody(c);
      const parsed = schema.safeParse(body);
      if (!parsed.success) {
        return b.toHttp(c, b.badRequest("Request body failed validation.", parsed.error.issues));
      }
      // Actor attribution: the canvas is the only client of these
      // routes, so anything they mutate is canvas-sourced activity — which
      // the canvas itself filters out of its own change highlights.
      const result = await withActor({ source: "canvas" }, () =>
        handler(parsed.data as z.infer<S>, b.ctxFor()),
      );
      return result.ok ? c.json(result.value) : b.toHttp(c, result.error);
    };
  };
}

/** Mutation-flavored route helper (api-mutate.ts, api-inspect.ts). */
export function makeRoute<Ctx>(ctxFor: () => Ctx) {
  return makeBoundRoute<MutationError, Ctx>({
    ctxFor,
    badRequest: mutationBadRequest,
    toHttp: mutationToHttp,
  });
}

/** Theme-flavored route helper (api-theme.ts). */
export function makeThemeRoute<Ctx>(ctxFor: () => Ctx) {
  return makeBoundRoute<ThemeError, Ctx>({
    ctxFor,
    badRequest: themeBadRequest,
    toHttp: themeToHttp,
  });
}
