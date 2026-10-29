import { Hono } from "hono";
import { z } from "zod";
import { readCanvasUserPrefs, writeCanvasUserPrefs } from "../user-prefs.ts";

const HintId = z.string().regex(/^[a-z][a-z-]{0,39}$/);
const PrefsBody = z
  .object({
    dismissHints: z.array(HintId).max(20).optional(),
    resetHints: z.literal(true).optional(),
  })
  .strict();

/**
 * The person's canvas preferences that must survive a new daemon port — kept
 * in `~/.velloo/prefs.json` rather than the browser (see `user-prefs.ts`).
 */
export function createPrefsRouter(): Hono {
  const app = new Hono();

  app.get("/", async (c) => c.json(await readCanvasUserPrefs()));

  app.post("/", async (c) => {
    const parsed = PrefsBody.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) {
      return c.json(
        { error: { kind: "BadRequest", message: "Request body failed validation." } },
        400,
      );
    }
    await writeCanvasUserPrefs(parsed.data);
    return c.json(await readCanvasUserPrefs());
  });

  return app;
}
