import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { loadManifest as loadBundledManifest, type Manifest } from "@velloo/shadcn-snapshot";
import { Hono } from "hono";
import type { DesignFolder } from "../design-folder.ts";

/**
 * Returns the prop manifest for the current design folder. Prefers the
 * on-disk `.design/manifest.json` (generated at init / on library upgrade
 * via ts-morph against the folder's actual components). Falls back to the
 * bundled shadcn-snapshot manifest if the design folder hasn't generated
 * one yet — keeps the canvas working on folders that predate Sprint C.
 */
async function loadManifestForFolder(folder: DesignFolder): Promise<Manifest> {
  const onDisk = join(folder.root, ".design", "manifest.json");
  try {
    const raw = await readFile(onDisk, "utf8");
    return JSON.parse(raw) as Manifest;
  } catch {
    return loadBundledManifest();
  }
}

export function createComponentsRouter(folder: () => DesignFolder): Hono {
  const r = new Hono();

  r.get("/", async (c) => {
    return c.json(await loadManifestForFolder(folder()));
  });

  return r;
}
