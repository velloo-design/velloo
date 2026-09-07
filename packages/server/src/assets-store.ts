import { readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import {
  type AssetsFile,
  AssetsFileSchema,
  EMPTY_ASSETS_FILE,
  type GeneratedAsset,
} from "@velloo/schema";
import type { DesignFolder } from "./design-folder.ts";
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

const assetsFilePath = (root: string): string => join(root, "assets.json");

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

/**
 * Whether any screen or snippet still points at `assetPath`. The design folder
 * is the only thing that can hold an asset alive, and a `src` is the only way
 * it does — so a JSON scan for the path is exact, and cheap enough at folder
 * size to beat maintaining a reverse index that could drift.
 *
 * Snippets count: a snippet body's `src` renders into every screen that
 * instantiates it, so an asset used only there is very much in use.
 */
export function assetReferences(folder: DesignFolder, assetPath: string): string[] {
  const url = `/${assetPath}`;
  const hits: string[] = [];
  const uses = (value: unknown): boolean => {
    const json = JSON.stringify(value) ?? "";
    return json.includes(`"${url}"`) || json.includes(`"${assetPath}"`);
  };
  for (const [id, screen] of folder.screens) if (uses(screen)) hits.push(`screen "${id}"`);
  for (const [id, snippet] of folder.snippets) if (uses(snippet)) hits.push(`snippet "${id}"`);
  return hits;
}

/**
 * Delete a generated asset: the file, then its provenance. Refuses while the
 * design still points at it — a design folder has no other record of which
 * bytes a screen needs, so an unlink there is unrecoverable in a way an undo
 * can't reach.
 */
export async function deleteGeneratedAsset(
  folder: DesignFolder,
  assetPath: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const root = folder.root;
  if (!assetPath.startsWith("assets/") || assetPath.includes("..")) {
    return { ok: false, reason: `"${assetPath}" is not a path inside this folder's asset store.` };
  }
  const used = assetReferences(folder, assetPath);
  if (used.length > 0) {
    return {
      ok: false,
      reason: `${assetPath} is still used by ${used.join(", ")} — point those at another image first.`,
    };
  }
  await unlink(join(root, assetPath)).catch(() => {
    // Already gone on disk is the desired end state, not a failure; the
    // provenance entry below still needs clearing.
  });
  await serialize(root, async () => {
    const file = await readAssetsFile(root);
    if (!(assetPath in file.generated)) return;
    const { [assetPath]: _dropped, ...rest } = file.generated;
    await writeJsonAtomic(assetsFilePath(root), {
      ...file,
      generated: rest,
    } satisfies AssetsFile);
  });
  return { ok: true };
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
