import { type Context, Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import { deleteGeneratedAsset, readAssetsFile } from "../assets-store.ts";
import type { CloudAuth } from "../cloud.ts";
import {
  ASPECTS,
  describeGenerateFailure,
  fetchIntentCatalog,
  generateAsset,
  INTENTS,
} from "../cloud-generate.ts";
import type { DesignFolder } from "../design-folder.ts";

/**
 * Asset provenance + canvas-driven generation.
 *
 * The MCP tool already generates; this router exists so the *human* can too.
 * Selecting a generated image in the canvas shows the prompt that made it and
 * re-rolls or rewrites it in place — the shortest loop between "not quite
 * right" and a new image, without a round trip through the agent.
 */

const GenerateBody = z.object({
  prompt: z.string().min(1).max(2000),
  intent: z.enum(INTENTS),
  aspect: z.enum(ASPECTS).optional(),
  reference: z.array(z.string()).max(3).optional(),
  /** Folder-relative path of the asset this replaces, for the provenance chain. */
  replaces: z.string().max(512).optional(),
});

export function createAssetsRouter(folder: () => DesignFolder, cloud?: CloudAuth): Hono {
  const app = new Hono();

  // Provenance for every generated asset in the folder. The canvas holds this
  // as a map and looks up the selected node's src — an asset that isn't here
  // is simply one velloo didn't generate.
  app.get("/", async (c) => {
    const file = await readAssetsFile(folder().root);
    return c.json({ generated: file.generated });
  });

  // The canvas reads `{ error: { code, message } }` (see routes/error-http.ts
  // and the api/http.ts client) and falls back to a bare "<route>: <status>"
  // when it can't find a message there. Every failure on this path already
  // carries a written-for-humans next step — sign in, top up, retry, or author
  // it yourself — so getting the envelope right is the whole point.
  const fail = (c: Context, status: ContentfulStatusCode, code: string, message: string) =>
    c.json({ error: { code, message } }, status);

  /**
   * The cloud's intent catalogue, proxied so the canvas can price the picker.
   * Not cached: the point of reading it live is that a repricing on the server
   * lands on the next open, and the payload is ten short rows.
   */
  app.get("/intents", async (c) => {
    if (!cloud) return c.json({ intents: [] });
    const r = await fetchIntentCatalog(cloud);
    // Prices are a nicety — a picker with no prices still generates, so an
    // unreachable or logged-out cloud degrades instead of failing the panel.
    return c.json(r.ok ? r.value : { intents: [] });
  });

  app.post("/delete", async (c) => {
    const body = (await c.req.json().catch(() => undefined)) as { assetPath?: unknown };
    if (typeof body?.assetPath !== "string") {
      return fail(c, 400, "BadRequest", "assetPath is required.");
    }
    const r = await deleteGeneratedAsset(folder(), body.assetPath);
    if (!r.ok) return fail(c, 409, "AssetInUse", r.reason);
    return c.json({ deleted: body.assetPath });
  });

  app.post("/generate", async (c) => {
    if (!cloud) {
      return fail(
        c,
        503,
        "LoggedOut",
        "This daemon has no velloo-cloud connection — run `velloo login`, then reopen the canvas.",
      );
    }
    const parsed = GenerateBody.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) {
      return fail(c, 400, "BadRequest", parsed.error.issues[0]?.message ?? "invalid request");
    }
    const r = await generateAsset(folder().root, cloud, parsed.data);
    if (!r.ok) {
      // The cloud's own status when it rejected; 400 for a request that was
      // wrong before it left; 502 for everything else local (unreachable,
      // unparseable) so a failure never reads as a client error.
      const status =
        r.error.kind === "LoggedOut"
          ? 401
          : r.error.kind === "InvalidRequest"
            ? 400
            : r.error.kind === "HttpFailure"
              ? r.error.status
              : 502;
      return fail(
        c,
        status as ContentfulStatusCode,
        r.error.kind,
        describeGenerateFailure(r.error),
      );
    }
    return c.json(r.value);
  });

  return app;
}
