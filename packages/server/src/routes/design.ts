import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { type Manifest, type StyleChannel, styleChannelOf } from "@velloo/provider";
import { isArchived } from "@velloo/schema";
import { Hono } from "hono";
import { activeBoards, type DesignFolder, orderedBoards } from "../design-folder.ts";
import type { MutationContext } from "../mutations/index.ts";
import { findSnippetInstances } from "../mutations/snippet-instances.ts";

/**
 * The design folder's read surface: the summary the canvas boots from plus
 * per-resource reads (screen, board, snippets) and the components manifest.
 */

/**
 * Nearest enclosing git repo's directory name — the design folder is often a
 * subdirectory (e.g. `<repo>/velloo`), and the tab title should read the repo.
 * Falls back to the design folder's own basename outside a repo.
 */
function projectNameFor(root: string): string {
  let dir = root;
  for (;;) {
    if (existsSync(join(dir, ".git"))) return basename(dir);
    const parent = dirname(dir);
    if (parent === dir) return basename(root);
    dir = parent;
  }
}

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
      snapshotVersion: ctx.defaultProvider.version,
      providerId: ctx.defaultProvider.id,
      // Multi-library summary. The canvas reads this to
      // render the library badge per frame and the active-library
      // selector in the Library tab.
      libraries,
      defaultLibrary: f.config.defaultLibrary ?? null,
      /** Enclosing repo (or design-folder) name — the browser tab title prefix. */
      folderName: projectNameFor(f.root),
      theme: { name: f.theme.name },
      defaultScreen: f.config.defaultScreen ?? null,
      defaultBoard: f.config.defaultBoard ?? null,
      viewportPresets: f.config.viewportPresets,
      screens: [...f.screens.entries()].map(([id, screen]) => ({
        id,
        name: screen.name,
        library: screen.library ?? f.config.defaultLibrary ?? null,
      })),
      boards: activeBoards(f).map(([id, board]) => ({
        id,
        name: board.name,
        frameCount: board.frames.length,
      })),
      /**
       * Archived boards, in the same sidebar order — served alongside rather
       * than inside `boards` so every existing consumer keeps seeing only
       * live boards, and the sidebar's Archived section has what it needs
       * without a second round trip.
       */
      archivedBoards: orderedBoards(f)
        .filter(([, board]) => isArchived(board))
        .map(([id, board]) => ({
          id,
          name: board.name,
          frameCount: board.frames.length,
          archivedAt: board.archivedAt ?? null,
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

export function createScreenRouter(folder: () => DesignFolder): Hono {
  const r = new Hono();

  r.get("/:id", (c) => {
    const f = folder();
    const screen = f.screens.get(c.req.param("id"));
    if (!screen) return c.json({ error: "screen not found" }, 404);
    return c.json(screen);
  });

  return r;
}

/**
 * GET /api/board/:id — return one board's full JSON.
 *
 * The boards list comes through /api/design (top-level summary).
 */
export function createBoardRouter(folder: () => DesignFolder): Hono {
  const r = new Hono();

  r.get("/:id", (c) => {
    const f = folder();
    const board = f.boards.get(c.req.param("id"));
    if (!board) return c.json({ error: "board not found" }, 404);
    return c.json(board);
  });

  return r;
}

export function createSnippetsRouter(folder: () => DesignFolder): Hono {
  const r = new Hono();

  r.get("/", (c) => {
    const f = folder();
    return c.json({
      snippets: [...f.snippets.entries()].map(([id, snippet]) => ({
        id,
        name: snippet.name,
        params: snippet.params,
      })),
    });
  });

  r.get("/:snippetId/instances", (c) => {
    const f = folder();
    const snippetId = c.req.param("snippetId");
    if (!f.snippets.has(snippetId)) return c.json({ error: "snippet not found" }, 404);
    return c.json({ instances: findSnippetInstances(f, snippetId) });
  });

  r.get("/:snippetId", (c) => {
    const f = folder();
    const snippet = f.snippets.get(c.req.param("snippetId"));
    if (!snippet) return c.json({ error: "snippet not found" }, 404);
    return c.json(snippet);
  });

  return r;
}

/**
 * Returns the prop manifest for the current design folder. Prefers the
 * on-disk `.design/manifest.json` (generated at init / library upgrade
 * via ts-morph against the folder's actual components). Falls back to
 * the active provider's bundled manifest if the folder hasn't generated
 * one yet — keeps the canvas working on folders that predate per-folder
 * manifest generation.
 */
async function loadManifestForCtx(ctx: MutationContext): Promise<Manifest> {
  const onDisk = join(ctx.folder.root, ".design", "manifest.json");
  try {
    const raw = await readFile(onDisk, "utf8");
    return JSON.parse(raw) as Manifest;
  } catch {
    return ctx.defaultProvider.loadManifest();
  }
}

export interface ComponentsResponse {
  manifest: Manifest;
  /** The default library's native style channel — drives the inspector's editor. */
  styleChannel: StyleChannel;
  /** Per-library channels (multi-library folders), so the inspector edits a screen in its library's channel. */
  channelsByLibrary: Record<string, StyleChannel>;
}

export function createComponentsRouter(ctxFor: () => MutationContext): Hono {
  const r = new Hono();

  r.get("/", async (c) => {
    const ctx = ctxFor();
    const manifest = await loadManifestForCtx(ctx);
    // Resolve each library's channel against the folder's CSS framework so a
    // none/none folder reports the inline-`style` channel (not Tailwind) — that
    // drives the inspector's editor + the agent's set_style shape.
    const css = ctx.folder.config.styling?.framework;
    const channelsByLibrary: Record<string, StyleChannel> = {};
    for (const [id, provider] of Object.entries(ctx.providers)) {
      channelsByLibrary[id] = styleChannelOf(provider, css);
    }
    const body: ComponentsResponse = {
      manifest,
      styleChannel: styleChannelOf(ctx.defaultProvider, css),
      channelsByLibrary,
    };
    return c.json(body);
  });

  return r;
}
