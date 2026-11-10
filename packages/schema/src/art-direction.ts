import { z } from "zod";

/**
 * The art direction: a design's look explored before it is built, in the design
 * folder's `art-direction.json`.
 *
 * It runs in stages, each one narrowing the last. A brief says what is being
 * designed. Directions are candidate looks, each in words an image model can
 * draw. A mood board is drawn per direction, then full-page mocks per chosen
 * direction (from its mood board when it has one), and the person picks the
 * one mock the design is built from. The agent writes the brief and the
 * directions; the person drops, picks and regenerates on the canvas; either can
 * move the stage on.
 *
 * Images live in the asset store under `assets/art-direction/`, so they are served
 * and listed like any other asset. This file only records what each image is.
 */

export const ART_DIRECTION_STAGES = ["brief", "directions", "boards", "mocks", "build"] as const;
export const ArtDirectionStageSchema = z.enum(ART_DIRECTION_STAGES);
export type ArtDirectionStage = z.infer<typeof ArtDirectionStageSchema>;

export const ArtDirectionImageSchema = z.object({
  /** Folder-relative asset path, e.g. "assets/art-direction/poster/board-1.jpg". */
  path: z.string(),
  /** The image model's public id, as the cloud listed it ("velloo-sketch"). */
  model: z.string(),
  /** Verbatim prompt, so a regenerate sends the same words. */
  prompt: z.string(),
  /** The mood board this mock was drawn from, when it was. */
  fromBoard: z.string().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  /** ISO-8601. */
  createdAt: z.string(),
});
export type ArtDirectionImage = z.infer<typeof ArtDirectionImageSchema>;

export const ArtDirectionDirectionSchema = z.object({
  /** Slug, unique in the art direction; also the image folder's name. */
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  /** Short name shown on the card ("Park poster"). */
  title: z.string().min(1),
  /**
   * The look in words, sent to the image model for the mood board: palette
   * (with hex values), type, texture, imagery, motifs, references.
   */
  description: z.string().min(1),
  /**
   * How the page is laid out in this look, sent with the description for a
   * mock: what the hero is, how each section is shown.
   */
  layout: z.string().default(""),
  /** Set when the person (or the agent) took the direction out of the running. */
  dropped: z.boolean().default(false),
  /**
   * Whether the direction goes on to mocks. Set on the mood-board step; a
   * direction nobody unpicked goes on.
   */
  picked: z.boolean().default(true),
  /** Every mood board drawn, oldest first; the last is the current one. */
  boards: z.array(ArtDirectionImageSchema).default([]),
  /** Every mock drawn for this direction, oldest first. */
  mocks: z.array(ArtDirectionImageSchema).default([]),
});
export type ArtDirectionDirection = z.infer<typeof ArtDirectionDirectionSchema>;

export const ArtDirectionBriefSchema = z.object({
  /** Whether the design exists already (read from the codebase) or is new. */
  origin: z.enum(["existing", "new"]),
  /** What the product is and who it is for, in a paragraph. */
  product: z.string().min(1),
  /** The page or screen being designed ("the landing page"). */
  page: z.string().min(1),
  /**
   * The page's real content, top to bottom: navigation, headings, copy,
   * buttons, figures. Mocks are drawn with exactly this copy, which is what
   * keeps them from inventing a different product.
   */
  content: z.string().default(""),
  /** Anything else the person asked for: audience, mood, must-keeps, no-gos. */
  notes: z.string().default(""),
});
export type ArtDirectionBrief = z.infer<typeof ArtDirectionBriefSchema>;

/**
 * The page of the app being redesigned, as the person picked it on the start
 * page: one of the app's routes, a captured page, a screen on the canvas, or
 * one they typed.
 */
export const ArtDirectionPageSchema = z.object({
  /** What it reads as ("/pricing", "Pricing", "Settings · Billing"). */
  label: z.string().min(1).max(200),
  /** The app's route for it, when there is one ("/en/pricing"). */
  route: z.string().max(500).optional(),
  /** The source file the route is served from, relative to the app root. */
  file: z.string().max(500).optional(),
  /** A browser capture of it (`list_captures`). */
  captureId: z.string().max(200).optional(),
  /** A screen on the canvas that already shows it. */
  screenId: z.string().max(200).optional(),
});
export type ArtDirectionPage = z.infer<typeof ArtDirectionPageSchema>;

export const ArtDirectionFileSchema = z.object({
  version: z.literal(1),
  stage: ArtDirectionStageSchema.default("brief"),
  /** Picked on the start page: redesign a page of the app, or something new. Null until then. */
  origin: z.enum(["existing", "new"]).nullable().default(null),
  /** For a redesign, the page picked on the start page; null leaves it to the agent to ask. */
  page: ArtDirectionPageSchema.nullable().default(null),
  /**
   * The canvas's Agent-tab session running the art direction, so opening the
   * art direction brings its conversation back, and reopening the
   * conversation brings back the art direction.
   */
  agentSession: z.string().nullable().default(null),
  brief: ArtDirectionBriefSchema.nullable().default(null),
  directions: z.array(ArtDirectionDirectionSchema).default([]),
  /** The person chose to go from directions straight to mocks. */
  skipBoards: z.boolean().default(false),
  /** Mocks drawn per picked direction. */
  mockCount: z.number().int().min(1).max(6).default(3),
  /** The image model picked for each kind; absent = the cloud's default. */
  models: z.object({ moodboard: z.string().optional(), mock: z.string().optional() }).default({}),
  /** The mock the design is built from. */
  chosen: z.object({ direction: z.string(), mock: z.string() }).nullable().default(null),
  /**
   * Whether the build may draw the photographs and illustrations the mock
   * shows with paid generation. Null until the person is asked, which they are
   * when they hand the mock to the agent.
   */
  generateImages: z.boolean().nullable().default(null),
});
export type ArtDirectionFile = z.infer<typeof ArtDirectionFileSchema>;

export const EMPTY_ART_DIRECTION: ArtDirectionFile = ArtDirectionFileSchema.parse({ version: 1 });

/** The directions still in the running. */
export const activeDirections = (artDirection: ArtDirectionFile): ArtDirectionDirection[] =>
  artDirection.directions.filter((d) => !d.dropped);

/** The current mood board of a direction: the last one drawn. */
export const currentBoard = (direction: ArtDirectionDirection): ArtDirectionImage | undefined =>
  direction.boards.at(-1);
