import { z } from "zod";

/**
 * The lookbook: a design's look explored before it is built, in the design
 * folder's `lookbook.json`.
 *
 * It runs in stages, each one narrowing the last. A brief says what is being
 * designed. Directions are candidate looks, each in words an image model can
 * draw. A mood board is drawn per direction, then full-page mocks per chosen
 * direction (from its mood board when it has one), and the person picks the
 * one mock the design is built from. The agent writes the brief and the
 * directions; the person drops, picks and regenerates on the canvas; either can
 * move the stage on.
 *
 * Images live in the asset store under `assets/lookbook/`, so they are served
 * and listed like any other asset. This file only records what each image is.
 */

export const LOOKBOOK_STAGES = ["brief", "directions", "boards", "mocks", "build"] as const;
export const LookbookStageSchema = z.enum(LOOKBOOK_STAGES);
export type LookbookStage = z.infer<typeof LookbookStageSchema>;

export const LookbookImageSchema = z.object({
  /** Folder-relative asset path, e.g. "assets/lookbook/poster/board-1.jpg". */
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
export type LookbookImage = z.infer<typeof LookbookImageSchema>;

export const LookbookDirectionSchema = z.object({
  /** Slug, unique in the lookbook; also the image folder's name. */
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
  boards: z.array(LookbookImageSchema).default([]),
  /** Every mock drawn for this direction, oldest first. */
  mocks: z.array(LookbookImageSchema).default([]),
});
export type LookbookDirection = z.infer<typeof LookbookDirectionSchema>;

export const LookbookBriefSchema = z.object({
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
export type LookbookBrief = z.infer<typeof LookbookBriefSchema>;

export const LookbookRequestSchema = z.object({
  id: z.string(),
  /** What the canvas asked the agent for. */
  kind: z.enum(["propose-directions", "revise-direction", "build", "note"]),
  /** The direction it is about, for revise-direction and build. */
  direction: z.string().optional(),
  /** The mock to build from, for build. */
  mock: z.string().optional(),
  text: z.string(),
  createdAt: z.string(),
});
export type LookbookRequest = z.infer<typeof LookbookRequestSchema>;

export const LookbookFileSchema = z.object({
  version: z.literal(1),
  stage: LookbookStageSchema.default("brief"),
  brief: LookbookBriefSchema.nullable().default(null),
  directions: z.array(LookbookDirectionSchema).default([]),
  /** The person chose to go from directions straight to mocks. */
  skipBoards: z.boolean().default(false),
  /** Mocks drawn per picked direction. */
  mockCount: z.number().int().min(1).max(6).default(3),
  /** The image model picked for each kind; absent = the cloud's default. */
  models: z.object({ moodboard: z.string().optional(), mock: z.string().optional() }).default({}),
  /** The mock the design is built from. */
  chosen: z.object({ direction: z.string(), mock: z.string() }).nullable().default(null),
  /**
   * Asks from the canvas that wait for an agent (propose more directions,
   * build from this mock), for when no agent was listening. The agent clears
   * each one once it has acted on it.
   */
  requests: z.array(LookbookRequestSchema).default([]),
});
export type LookbookFile = z.infer<typeof LookbookFileSchema>;

export const EMPTY_LOOKBOOK: LookbookFile = LookbookFileSchema.parse({ version: 1 });

/** The directions still in the running. */
export const activeDirections = (lookbook: LookbookFile): LookbookDirection[] =>
  lookbook.directions.filter((d) => !d.dropped);

/** The current mood board of a direction: the last one drawn. */
export const currentBoard = (direction: LookbookDirection): LookbookImage | undefined =>
  direction.boards.at(-1);
