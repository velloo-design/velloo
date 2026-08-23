import { Hono } from "hono";
import { orderedBoards } from "../design-folder.ts";
import type { MutationContext } from "../mutations/index.ts";

export function createDesignRouter(ctxFor: () => MutationContext): Hono {
  const r = new Hono();

  r.get("/", (c) => {
    const ctx = ctxFor();
    const f = ctx.folder;
    const libraries = f.config.libraries
      ? Object.fromEntries(
          Object.entries(f.config.libraries).map(([id, lib]) => [
            id,
            { providerId: lib.id, version: lib.version },
          ]),
        )
      : {};
    return c.json({
      snapshotVersion: ctx.provider.version,
      providerId: ctx.provider.id,
      // Multi-library summary. The canvas reads this to
      // render the library badge per frame and the active-library
      // selector in the Library tab.
      libraries,
      defaultLibrary: f.config.defaultLibrary ?? null,
      theme: { name: f.theme.name },
      defaultScreen: f.config.defaultScreen ?? null,
      defaultBoard: f.config.defaultBoard ?? null,
      viewportPresets: f.config.viewportPresets,
      screens: [...f.screens.entries()].map(([id, screen]) => ({
        id,
        name: screen.name,
        library: screen.library ?? f.config.defaultLibrary ?? null,
      })),
      boards: orderedBoards(f).map(([id, board]) => ({
        id,
        name: board.name,
        frameCount: board.frames.length,
      })),
      snippets: [...f.snippets.entries()].map(([id, snippet]) => ({
        id,
        name: snippet.name,
        params: snippet.params,
        library: snippet.library ?? f.config.defaultLibrary ?? null,
      })),
      extensionsCount: Object.keys(f.config.extensions ?? {}).length,
    });
  });

  return r;
}
