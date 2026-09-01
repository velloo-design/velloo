import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type AssetsFile,
  AssetsFileSchema,
  EMPTY_ASSETS_FILE,
  type GeneratedAsset,
} from "@velloo/schema";
import { writeJsonAtomic } from "./fs.ts";

/**
 * The design folder's `assets.json` — provenance for everything
 * `generate_asset` produced (see the schema for why it's worth keeping).
 *
 * Deliberately NOT part of `DesignFolder`: the loader's maps are the tree the
 * mutation layer locks around, and this file is touched only by generation and
 * read only by the assets routes. Keeping it out means a generation can't
 * invalidate a screen lock, and a corrupt `assets.json` degrades to "no
 * provenance" instead of failing the folder load.
 */

export const assetsFilePath = (root: string): string => join(root, "assets.json");

/**
 * Read the store. A missing file is the normal case (a folder that has never
 * generated anything); a malformed one is treated the same way rather than
 * throwing, because provenance is an enhancement — losing it must never stop
 * the canvas from rendering images.
 */
export async function readAssetsFile(root: string): Promise<AssetsFile> {
  let raw: string;
  try {
    raw = await readFile(assetsFilePath(root), "utf8");
  } catch {
    return EMPTY_ASSETS_FILE;
  }
  try {
    const parsed = AssetsFileSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : EMPTY_ASSETS_FILE;
  } catch {
    return EMPTY_ASSETS_FILE;
  }
}

/**
 * Serialize writes per folder. Two `generate_asset` calls can land at once
 * (the tool takes `count`, and nothing stops an agent batching), and a
 * read-modify-write race would silently drop one generation's provenance.
 */
const writeChains = new Map<string, Promise<unknown>>();

function serialize<T>(root: string, op: () => Promise<T>): Promise<T> {
  const prev = writeChains.get(root) ?? Promise.resolve();
  const next = prev.then(op, op);
  // Keep the chain alive but don't let a rejection poison the next writer.
  writeChains.set(
    root,
    next.catch(() => {}),
  );
  return next;
}

/** Record provenance for freshly generated assets, merging into the store. */
export async function recordGeneratedAssets(
  root: string,
  entries: Record<string, GeneratedAsset>,
): Promise<void> {
  if (Object.keys(entries).length === 0) return;
  await serialize(root, async () => {
    const file = await readAssetsFile(root);
    await writeJsonAtomic(assetsFilePath(root), {
      ...file,
      generated: { ...file.generated, ...entries },
    } satisfies AssetsFile);
  });
}
