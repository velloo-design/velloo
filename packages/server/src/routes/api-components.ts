import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Manifest } from "@velloo/provider";
import { Hono } from "hono";
import type { MutationContext } from "../mutations/index.ts";

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
    return ctx.provider.loadManifest();
  }
}

export function createComponentsRouter(ctxFor: () => MutationContext): Hono {
  const r = new Hono();

  r.get("/", async (c) => {
    return c.json(await loadManifestForCtx(ctxFor()));
  });

  return r;
}
