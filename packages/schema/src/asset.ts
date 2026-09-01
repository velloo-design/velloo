import { z } from "zod";

/**
 * Provenance for the assets `generate_asset` produced, stored in the design
 * folder's `assets.json`.
 *
 * A generated image is the one asset a designer cannot re-derive by looking at
 * it: the prompt that made it lives only in the agent transcript that ran the
 * generation, so a week later nobody can nudge the image without starting over.
 * Recording it next to the design turns every generated asset into something
 * you can re-roll or rewrite from the canvas.
 *
 * Keyed by folder-relative asset path, so an image the canvas has selected
 * (`/assets/hero.png` → `assets/hero.png`) is a direct lookup, and an asset
 * that isn't in the map is simply one velloo didn't generate.
 */
export const GeneratedAssetSchema = z.object({
  /** Verbatim prompt, so it can be edited and re-run. */
  prompt: z.string(),
  /**
   * Intent name from the cloud catalogue ("photo", "illustration", …). This is
   * as specific as provenance gets on purpose: which model serves an intent is
   * the cloud's to change, so recording a model name here would bake a
   * server-side detail into every design folder.
   */
  intent: z.string(),
  /** Requested aspect; absent for intents whose output follows their input. */
  aspect: z.string().optional(),
  /** Pixel dimensions, when the result was a raster. */
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  /** ISO-8601, so the panel can say how old an image is. */
  generatedAt: z.string(),
  /** Reference assets the generation worked from (edit/cutout/upscale). */
  reference: z.array(z.string()).optional(),
  /**
   * The asset this one was generated to replace. Set when a regenerate ran
   * from the canvas, so the chain back to the original stays walkable after
   * several re-rolls.
   */
  replaces: z.string().optional(),
});
export type GeneratedAsset = z.infer<typeof GeneratedAssetSchema>;

export const AssetsFileSchema = z.object({
  version: z.literal(1),
  /** Keyed by folder-relative asset path, e.g. "assets/hero.png". */
  generated: z.record(z.string(), GeneratedAssetSchema),
});
export type AssetsFile = z.infer<typeof AssetsFileSchema>;

export const EMPTY_ASSETS_FILE: AssetsFile = { version: 1, generated: {} };

/**
 * Folder-relative asset path for a node's `src`, or null when the src points
 * somewhere else (a remote URL, a host-app path). The canvas writes srcs as
 * `/assets/<name>`; the store keys on `assets/<name>`.
 */
export function assetPathFromSrc(src: string): string | null {
  if (typeof src !== "string" || src.length === 0) return null;
  const trimmed = src.replace(/^\.?\//, "");
  if (!trimmed.startsWith("assets/")) return null;
  // A query/hash is a cache-buster, not part of the stored name.
  const clean = trimmed.split(/[?#]/)[0] ?? "";
  return clean.length > "assets/".length ? clean : null;
}
