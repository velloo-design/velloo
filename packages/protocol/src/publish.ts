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
  /**
   * The host app's stylesheets for an HTML/htmx design, in cascade order:
   * a shipped copy under `assets/host/` (its `url()`s re-pointed at shipped
   * `/assets/host/…` files) or an https URL the app loaded from elsewhere.
   */
  hostStylesheets: z
    .array(
      z
        .string()
        .regex(/^(?:assets\/host\/[A-Za-z0-9._@~+-][A-Za-z0-9._@~+/-]*\.css|https:\/\/\S+)$/),
    )
    .optional(),
  /**
   * The app's own global CSS for a React design, by screen id: the path of a
   * shipped stylesheet (`app-<hash>.css`) built from what the design's preview
   * entry imports. The viewer puts it last in the head, where the canvas has
   * it. Screens of one app share one file.
   */
  appStylesheets: z.record(z.string(), z.string().regex(/^app-[a-z0-9]+\.css$/)).optional(),
  /**
   * Screens as the canvas drew them, by screen id and then by variant
   * (`frozenVariantKey`): the path of a shipped {@link FrozenScreenSchema}.
   *
   * The app's own components only exist where the app's code runs, and the
   * cloud never runs it. So for a screen that uses them, publish mounts it
   * locally and ships the resulting DOM; the viewer shows that instead of
   * re-rendering the tree, which is what makes a share the same picture as
   * the canvas rather than a frame standing in for each component. A screen
   * or variant with no entry is rendered from its tree.
   */
  frozenScreens: z
    .record(z.string(), z.record(z.string(), z.string().regex(/^frozen\/[a-z0-9]+\.json$/)))
    .optional(),
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
 * One screen, one theme, one color scheme, as markup: everything the canvas
 * document's `<head>` carried that styles the page, and the mounted tree.
 * Nothing in it runs. The elements keep their `data-node-path`, so comments
 * and selection anchor exactly as they do on a tree the viewer rendered.
 */
export const FrozenScreenSchema = z.strictObject({
  /** The `<style>` and stylesheet `<link>` elements, in cascade order. */
  head: z.string(),
  /** The mounted tree's markup. */
  body: z.string(),
  /**
   * The attributes the page's code put on `<html>` and `<body>`. A component
   * library styles from these as often as from a class on its own elements —
   * Mantine's whole stylesheet hangs off `data-mantine-color-scheme` on the
   * root — so markup without them is the right DOM painted by none of its CSS.
   */
  htmlAttributes: z.record(z.string(), z.string()),
  bodyAttributes: z.record(z.string(), z.string()),
});
export type FrozenScreen = z.infer<typeof FrozenScreenSchema>;

/** Which variant of a screen a frame shows: the theme it is pinned to, and its scheme. */
export function frozenVariantKey(themeName: string, scheme: "light" | "dark"): string {
  return `${themeName}/${scheme}`;
}

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
