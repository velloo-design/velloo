import { z } from "zod";

/**
 * A sketchbook: a design's look explored before it is built. A design keeps
 * as many as the person starts, one file each in `sketchbooks/<id>.json`,
 * so an earlier one can be reopened and taken further.
 *
 * It runs in stages, each one narrowing the last. A brief says what is being
 * designed. Directions are candidate looks, each in words an image model can
 * draw. A mood board is drawn per direction, then full-page mocks per chosen
 * direction (from its mood board when it has one), and the person picks the
 * images (mocks, or mood boards when they skip the mocks) the agent designs
 * screens from: inspiration for the screens, not a spec of them. The agent
 * writes the brief and the directions; the person drops, picks, revises and
 * regenerates on the canvas; either can move the stage on.
 *
 * Images live in the asset store under `assets/sketchbook/`, so they are served
 * and listed like any other asset. This file only records what each image is.
 */

export const SKETCHBOOK_STAGES = ["brief", "directions", "boards", "mocks", "screens"] as const;
export const SketchbookStageSchema = z.enum(SKETCHBOOK_STAGES);
export type SketchbookStage = z.infer<typeof SketchbookStageSchema>;

export const SketchbookImageSchema = z.object({
  /** Folder-relative asset path, e.g. "assets/sketchbook/poster/board-1.jpg". */
  path: z.string(),
  /** The image model's public id, as the cloud listed it ("velloo-sketch"). */
  model: z.string(),
  /** Verbatim prompt, so a regenerate sends the same words. */
  prompt: z.string(),
  /** The mood board this mock was drawn from, when it was. */
  fromBoard: z.string().optional(),
  /** The mock this one revises, when it does. */
  revisedFrom: z.string().optional(),
  /** What the person asked the revision to change ("more spacious"). */
  instruction: z.string().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  /** ISO-8601. */
  createdAt: z.string(),
});
export type SketchbookImage = z.infer<typeof SketchbookImageSchema>;

export const SketchbookDirectionSchema = z.object({
  /** Slug, unique in the sketchbook; also the image folder's name. */
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
  boards: z.array(SketchbookImageSchema).default([]),
  /** Every mock drawn for this direction, oldest first. */
  mocks: z.array(SketchbookImageSchema).default([]),
});
export type SketchbookDirection = z.infer<typeof SketchbookDirectionSchema>;

export const SketchbookBriefSchema = z.object({
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
export type SketchbookBrief = z.infer<typeof SketchbookBriefSchema>;

/**
 * The page of the app being redesigned, as the person picked it on the start
 * page: one of the app's routes, a captured page, a screen on the canvas, or
 * one they typed.
 */
export const SketchbookPageSchema = z.object({
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
export type SketchbookPage = z.infer<typeof SketchbookPageSchema>;

/**
 * An image the agent designs a screen from: a mock, or a mood board when the
 * person skips the mocks. `{ mock }` is how a file from before a mood board
 * could be chosen says it.
 */
export const SketchbookChoiceSchema = z.object({ direction: z.string(), image: z.string() });
export type SketchbookChoice = z.infer<typeof SketchbookChoiceSchema>;

/** `{ direction, mock }` is how a file from before a mood board could be chosen says it. */
const legacyChoice = (v: unknown): unknown =>
  v && typeof v === "object" && "mock" in v && !("image" in v)
    ? { direction: (v as { direction?: unknown }).direction, image: (v as { mock: unknown }).mock }
    : v;

export const SketchbookFileSchema = z.object({
  version: z.literal(1),
  /** What the person calls it; empty until named, when the brief's page stands in. */
  name: z.string().max(120).default(""),
  /** ISO-8601. */
  createdAt: z.string().optional(),
  /** ISO-8601, every write: the most recent is the one an agent reads by default. */
  updatedAt: z.string().optional(),
  /** "build" is what the last stage was called before it was "screens". */
  stage: z
    .preprocess((v) => (v === "build" ? "screens" : v), SketchbookStageSchema)
    .default("brief"),
  /** Picked on the start page: redesign a page of the app, or something new. Null until then. */
  origin: z.enum(["existing", "new"]).nullable().default(null),
  /** For a redesign, the page picked on the start page; null leaves it to the agent to ask. */
  page: SketchbookPageSchema.nullable().default(null),
  /**
   * The canvas's Agent-tab session running the sketchbook, so opening the
   * sketchbook brings its conversation back, and reopening the
   * conversation brings back the sketchbook.
   */
  agentSession: z.string().nullable().default(null),
  brief: SketchbookBriefSchema.nullable().default(null),
  directions: z.array(SketchbookDirectionSchema).default([]),
  /** The person chose to go from directions straight to mocks. */
  skipBoards: z.boolean().default(false),
  /** Mocks drawn per picked direction. */
  mockCount: z.number().int().min(1).max(6).default(2),
  /** The image model picked for each kind; absent = the cloud's default. */
  models: z.object({ moodboard: z.string().optional(), mock: z.string().optional() }).default({}),
  /**
   * The images the screens are designed from, one screen each. A single
   * object (or null) is how a file from before several could be chosen says it.
   */
  chosen: z.preprocess(
    (v) => (v == null ? [] : Array.isArray(v) ? v : [v]).map(legacyChoice),
    z.array(SketchbookChoiceSchema),
  ),
  /** The board the screens go on, made when the agent starts on them. */
  buildBoard: z.string().nullable().default(null),
  /** What the person added for the screens, in their words. */
  buildNotes: z.string().max(2000).default(""),
  /** Whether a chosen mock goes to the agent with the mood board it was drawn from. */
  buildWithBoards: z.boolean().default(true),
  /**
   * Whether the screens may draw the photographs and illustrations the images
   * show with paid generation. Null until the person is asked, which they are
   * when they hand the images to the agent.
   */
  generateImages: z.boolean().nullable().default(null),
});
export type SketchbookFile = z.infer<typeof SketchbookFileSchema>;

export const EMPTY_SKETCHBOOK: SketchbookFile = SketchbookFileSchema.parse({ version: 1 });

/** The directions still in the running. */
export const activeDirections = (sketchbook: SketchbookFile): SketchbookDirection[] =>
  sketchbook.directions.filter((d) => !d.dropped);

/** What a sketchbook is called on the canvas: its name, else the page it redesigns. */
export const sketchbookName = (sketchbook: SketchbookFile): string =>
  sketchbook.name.trim() ||
  sketchbook.brief?.page.trim() ||
  sketchbook.page?.label ||
  (sketchbook.origin === "new" ? "Something new" : "Untitled sketchbook");

/** The current mood board of a direction: the last one drawn. */
export const currentBoard = (direction: SketchbookDirection): SketchbookImage | undefined =>
  direction.boards.at(-1);
