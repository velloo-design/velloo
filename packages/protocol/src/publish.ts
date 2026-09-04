import {
  AnnotationSchema,
  BoardSchema,
  CanvasNoteSchema,
  ExtensionSchema,
  LibrarySchema,
  ScreenSchema,
  SnippetSchema,
  ThemeSchema,
  ViewportPresetSchema,
  ViewportSchema,
} from "@velloo/schema";
import { z } from "zod";
import { DESIGN_BUNDLE_FORMAT, type DesignBundleMeta } from "./publish-meta.ts";

/**
 * `design.json` — the design model `velloo publish` uploads and the cloud's
 * share viewer renders from.
 *
 * This is the largest thing velloo sends anywhere, and until this file existed
 * it had no declaration on either side: an inline object literal in the CLI,
 * typed by inference, hand-redeclared as an interface in velloo-cloud's viewer
 * and distilled by `typeof` guards in its ingest route. Three descriptions of
 * one payload, none of them checked against the others — and they had already
 * drifted (the cloud declared `libraries` as `{ id: string }` and read a
 * `description` field no velloo client has ever written).
 *
 * One declaration now. The CLI validates its own output before upload, the
 * cloud validates the slice it reads on ingest (`publish-meta.ts`), and the
 * viewer takes its type from here.
 *
 * Strict on purpose: an unexpected key means the writer and this file have
 * diverged, which is the failure this module exists to make loud.
 */
export const DesignBundleSchema = z.strictObject({
  /** @see DESIGN_BUNDLE_FORMAT */
  formatVersion: z.literal(DESIGN_BUNDLE_FORMAT),
  title: z.string(),
  viewport: ViewportSchema,
  defaultLibrary: z.string(),
  libraries: z.record(z.string(), LibrarySchema),
  extensions: z.record(z.string(), ExtensionSchema),
  viewportPresets: z.array(ViewportPresetSchema),
  theme: ThemeSchema,
  themes: z.record(z.string(), ThemeSchema),
  customCss: z.string(),
  snippets: z.array(SnippetSchema),
  screens: z.array(ScreenSchema),
  boards: z.array(BoardSchema),
  /** Node-anchored designer annotations, keyed by screen id. */
  annotations: z.record(z.string(), z.array(AnnotationSchema)),
  /** Free board notes in board coordinates, keyed by board id. */
  notes: z.record(z.string(), z.array(CanvasNoteSchema)),
  /** Whether the bundle carries a live-island bundle to client-mount. */
  live: z.boolean(),
  snapshotCssPath: z.string(),
  /** Present only when `live` — the path of the island bundle in the archive. */
  bundlePath: z.string().optional(),
  /** Static PNGs shipped alongside; the cloud uses them for og:image. */
  screenshots: z
    .object({
      cover: z.string(),
      screens: z.record(z.string(), z.string()),
      boards: z.record(z.string(), z.string()),
    })
    .optional(),
});

export type DesignBundle = z.infer<typeof DesignBundleSchema>;

/**
 * Compile-time proof that a real bundle satisfies the projection the cloud
 * ingests — the same guarantee `comments-compat.ts` gives the comment wire.
 * If either side drifts, this stops compiling.
 *
 * It lives here rather than beside `publish-meta.ts` so that module can stay
 * zod-only: the cloud carries it into a container with no velloo checkout.
 */
export type BundleSatisfiesMeta = DesignBundle extends DesignBundleMeta ? true : never;
const bundleSatisfiesMeta: BundleSatisfiesMeta = true;
void bundleSatisfiesMeta;

export { DESIGN_BUNDLE_FORMAT } from "./publish-meta.ts";
