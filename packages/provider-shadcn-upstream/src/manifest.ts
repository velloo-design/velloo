import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Manifest } from "@velloo/provider";

/**
 * Read a cache's pre-generated `manifest.json` into memory; throws if missing.
 * `createProvider` prefers this when a `cacheDir` was supplied and falls back to
 * the snapshot manifest otherwise.
 */
export async function readManifest(cacheDir: string): Promise<Manifest> {
  const raw = await readFile(join(cacheDir, "manifest.json"), "utf8");
  return JSON.parse(raw) as Manifest;
}
