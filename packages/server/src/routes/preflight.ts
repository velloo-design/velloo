import { Hono } from "hono";
import type { MutationContext } from "../mutations/index.ts";
import { preflightScreens, screensForBoards, screensForExportTarget } from "../preflight.ts";

/**
 * GET /api/preflight — which components would fail to render, for the screens
 * an export or publish is about to cover.
 *
 * The canvas cannot render, so it asks here before committing to work whose
 * output leaves the machine. Scope is either one export target
 * (?kind=frame|board|screen&id=…) or a publish's board selection
 * (?boards=a,b, or omitted for every screen).
 */
export function createPreflightRouter(ctxFor: () => MutationContext): Hono {
  const r = new Hono();

  r.get("/", (c) => {
    const folder = ctxFor().folder;
    const source = {
      folder,
      providers: ctxFor().providers,
      defaultProvider: ctxFor().defaultProvider,
    };

    const kind = c.req.query("kind");
    const id = c.req.query("id");
    if (kind !== undefined || id !== undefined) {
      if (kind !== "frame" && kind !== "board" && kind !== "screen") {
        return c.json({ error: "kind must be frame, board, or screen" }, 400);
      }
      if (!id) return c.json({ error: "id is required with kind" }, 400);
      const screens = screensForExportTarget(folder, kind, id);
      if (screens.length === 0) return c.json({ error: `no ${kind} with id "${id}"` }, 404);
      return c.json({ failures: preflightScreens(source, screens) });
    }

    const boards = c.req.query("boards");
    // No board filter means the whole folder, matching what publish sends.
    const screens =
      boards === undefined || boards === ""
        ? [...folder.screens.values()]
        : screensForBoards(folder, boards.split(","));
    return c.json({ failures: preflightScreens(source, screens) });
  });

  return r;
}
