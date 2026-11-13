import { z } from "zod";

/**
 * A Look: what is kept from a sketchbook and applied to boards. It is a
 * one-to-one sidecar of a theme — `looks/<name>.json` beside
 * `theme/<name>.json`, the same stem — so the theme stays the token store that
 * emit, import, the specimen and the share viewer read unchanged, and this
 * holds the rest: the images the look came from, its own rules, how its
 * imagery is drawn and where it came from. A theme with no sidecar is a plain
 * Look: tokens and no imagery. Every field is defaulted, so `{}` is a Look.
 */

/** The kinds an image is known as; any other string is kept as written. */
export const LOOK_IMAGE_KINDS = ["moodboard", "mock", "image"] as const;

/** A sketchbook direction, as a Look's image or the Look itself names where it came from. */
export const LookSourceSchema = z.object({
  sketchbook: z.string().min(1),
  direction: z.string().min(1),
});
export type LookSource = z.infer<typeof LookSourceSchema>;

export const LookImageSchema = z.object({
  /** Folder-relative asset path, e.g. "assets/sketchbook/abc/park/board-1.jpg". */
  path: z.string().min(1),
  /** What the image is: one of {@link LOOK_IMAGE_KINDS}, or a kind added since. */
  kind: z.string().min(1).default("image"),
  note: z.string().optional(),
  /** The sketchbook direction it was drawn for, when it was. */
  source: LookSourceSchema.optional(),
});
export type LookImage = z.infer<typeof LookImageSchema>;

/** A screenshot or a captured page the Look refers to. */
export const LookReferenceSchema = z.object({
  path: z.string().optional(),
  url: z.string().optional(),
  captureId: z.string().optional(),
  note: z.string().optional(),
});
export type LookReference = z.infer<typeof LookReferenceSchema>;

export const LookRulesSchema = z.object({
  dos: z.array(z.string()).default([]),
  donts: z.array(z.string()).default([]),
});
export type LookRules = z.infer<typeof LookRulesSchema>;

export const LookSchema = z.object({
  version: z.literal(1).default(1),
  /** The Look in one line, shown under its name. */
  description: z.string().default(""),
  images: z.array(LookImageSchema).default([]),
  references: z.array(LookReferenceSchema).default([]),
  /** Its own do's and don'ts, layered over the design's rules (a repo DESIGN.md outranks them). */
  rules: LookRulesSchema.default({ dos: [], donts: [] }),
  /** How photographs and illustrations are drawn in this Look; image generation reads it. */
  imagery: z.string().default(""),
  /** The sketchbook direction it was made from; null when it was made some other way. */
  origin: LookSourceSchema.nullable().default(null),
  /** ISO-8601. */
  createdAt: z.string().optional(),
  /** ISO-8601. */
  updatedAt: z.string().optional(),
});
export type Look = z.infer<typeof LookSchema>;
