import type { Look, SketchbookFile } from "@velloo/schema";

/** The cloud's own limits on a version (velloo-cloud `upload-safety.ts`). */
export const CLOUD_MAX_FILES = 500;
export const CLOUD_MAX_FILE_BYTES = 12 * 1024 * 1024;

/** What a bundle carries of the design's Looks and sketchbooks, and the images they name. */
export interface LooksAndSketchbooks {
  looks?: Record<string, Look>;
  sketchbooks?: Record<string, SketchbookFile>;
  /** Folder-relative `assets/…` paths, the Looks' first: what is left out when room runs short. */
  images: string[];
}

const isAsset = (path: string | undefined): path is string =>
  path !== undefined && /^assets\/[^?#\\]+$/.test(path) && !path.split("/").includes("..");

/**
 * Every Look with a sidecar and every sketchbook, as the share shows them. A
 * sketchbook loses its `agentSession`: which canvas tab runs it means nothing
 * on a share.
 */
export function looksAndSketchbooks(
  looks: ReadonlyMap<string, Look>,
  sketchbooks: readonly { id: string; sketchbook: SketchbookFile }[],
): LooksAndSketchbooks {
  const images = new Set<string>();
  const see = (path: string | undefined) => {
    if (isAsset(path)) images.add(path);
  };
  const lookEntries = [...looks].sort(([a], [b]) => a.localeCompare(b));
  for (const [, look] of lookEntries) {
    for (const image of look.images) see(image.path);
    for (const reference of look.references) see(reference.path);
  }
  const sketchbookEntries = [...sketchbooks].sort((a, b) => a.id.localeCompare(b.id));
  for (const { sketchbook } of sketchbookEntries) {
    for (const direction of sketchbook.directions) {
      for (const image of direction.images) see(image.path);
    }
    for (const reference of sketchbook.references) see(reference.path);
  }
  return {
    ...(lookEntries.length > 0 && { looks: Object.fromEntries(lookEntries) }),
    ...(sketchbookEntries.length > 0 && {
      sketchbooks: Object.fromEntries(
        sketchbookEntries.map(({ id, sketchbook }) => [id, { ...sketchbook, agentSession: null }]),
      ),
    }),
    images: [...images],
  };
}
