import { z } from "zod";

/**
 * The slice of `design.json` velloo-cloud's ingest path reads, and the format
 * stamp both ends agree on.
 *
 * Deliberately **zod-only**, exactly like `comments.ts`: velloo-cloud's server
 * runs unbundled from a container with no velloo checkout, so this file is
 * carried into the image on its own (`scripts/stage-velloo-protocol.ts`). The
 * full bundle declaration lives next door in `publish.ts`, which imports
 * `@velloo/schema` and therefore can never be staged — and does not need to
 * be: the cloud stores the bundle and serves it back, it never renders it.
 * Rendering is the share viewer's job, and the viewer *is* bundled.
 *
 * `publish.ts` carries the compile-time proof that a real bundle satisfies
 * this projection, so the two cannot fork.
 */

/**
 * Bundle format the current CLI writes. Bump when a change would make an
 * older cloud (or viewer) render a bundle *wrongly* — not for additive
 * optional fields, which every reader already tolerates.
 */
export const DESIGN_BUNDLE_FORMAT = 1;

export const BundleScreenshotsSchema = z.object({
  cover: z.string().optional(),
  screens: z.record(z.string(), z.string()).optional(),
  boards: z.record(z.string(), z.string()).optional(),
});
export type BundleScreenshots = z.infer<typeof BundleScreenshotsSchema>;

/**
 * What the cloud reads out of an uploaded `design.json`.
 *
 * A projection, not a validation of the whole design: the fields here are the
 * ones the versions endpoint turns into share metadata (page title, screen
 * list, og:image). Everything else in the bundle is opaque bytes to the
 * server. Unknown keys are stripped rather than rejected, so velloo can add
 * to the bundle without a cloud deploy.
 *
 * Every field is optional on purpose. The server's contract is "read what is
 * there" — a bundle missing `boards` renders fine and always did, so refusing
 * it would be the schema inventing a requirement nobody has. What this does
 * enforce is *types*: `title: 42` or `screens: "home"` is a bundle no reader
 * can use, and it now fails at the door instead of silently producing a share
 * page with no title. The one hard gate is `formatVersion`.
 *
 * `formatVersion` is optional because bundles published before the field
 * existed are still in storage and still render — absent means format 1. What
 * the cloud must refuse is a *newer* format it cannot be trusted to serve.
 */
export const DesignBundleMetaSchema = z.object({
  formatVersion: z.number().int().positive().optional(),
  title: z.string().optional(),
  screens: z.array(z.object({ id: z.string(), name: z.string().optional() })).optional(),
  boards: z.array(z.object({ id: z.string() })).optional(),
  screenshots: BundleScreenshotsSchema.optional(),
});
export type DesignBundleMeta = z.infer<typeof DesignBundleMetaSchema>;

/** The format an ingested bundle claims — absent means the pre-stamp format. */
export function bundleFormatOf(meta: DesignBundleMeta): number {
  return meta.formatVersion ?? 1;
}
