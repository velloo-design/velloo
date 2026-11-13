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
 * screens from: inspiration for the screens, not a spec of them. Other kinds
 * of image (a palette, a type poster, …) can be drawn beside them; the cloud's
 * intent list says which. The agent
 * writes the brief and the directions; the person drops, picks, revises and
 * regenerates on the canvas; either can move the stage on.
 *
 * Images live in the asset store under `assets/sketchbook/`, so they are served
 * and listed like any other asset. This file only records what each image is.
 */

export const SKETCHBOOK_STAGES = [
  "brief",
  "directions",
  "boards",
  "mocks",
  "screens",
  "tokens",
] as const;
export const SketchbookStageSchema = z.enum(SKETCHBOOK_STAGES);
export type SketchbookStage = z.infer<typeof SketchbookStageSchema>;

/**
 * What a sketchbook explores: a page (its mocks become screens) or a Look on
 * its own (its palettes and type become a theme's tokens, with no page drawn).
 */
export const SketchbookSubjectSchema = z.enum(["page", "look"]);
export type SketchbookSubject = z.infer<typeof SketchbookSubjectSchema>;

const STAGES_BY_SUBJECT: Record<SketchbookSubject, readonly SketchbookStage[]> = {
  page: ["brief", "directions", "boards", "mocks", "screens"],
  look: ["brief", "directions", "boards", "tokens"],
};

/** The stages a sketchbook on this subject goes through, in order. */
export const stagesFor = (subject: SketchbookSubject): readonly SketchbookStage[] =>
  STAGES_BY_SUBJECT[subject];

/**
 * The kinds of image a direction is drawn as. The cloud lists the ones it
 * draws (`group=sketchbook`); a kind it adds later is kept as written.
 */
export const SKETCHBOOK_IMAGE_KINDS = [
  "moodboard",
  "mock",
  "palette",
  "typeposter",
  "uikit",
  "imagery",
  "icons",
  "mobile",
  "detail",
] as const;
export type SketchbookImageKind = (typeof SKETCHBOOK_IMAGE_KINDS)[number];

/** The kinds that are a page, so a screen can be designed from one (a mood board can too). */
export const PAGE_IMAGE_KINDS: readonly string[] = ["mock", "mobile", "detail"];

/** Whether a screen can be designed from an image of this kind. */
export const designsScreens = (kind: string): boolean =>
  kind === "moodboard" || PAGE_IMAGE_KINDS.includes(kind);

export const SketchbookImageSchema = z.object({
  /** What it is: one of {@link SKETCHBOOK_IMAGE_KINDS}, or a kind the cloud added since. */
  kind: z.string().min(1),
  /** Folder-relative asset path, e.g. "assets/sketchbook/poster/board-1.jpg". */
  path: z.string(),
  /** The image model's public id, as the cloud listed it ("velloo-sketch"). */
  model: z.string(),
  /** Verbatim prompt, so a regenerate sends the same words. */
  prompt: z.string(),
  /** The mood board it was drawn from, when it was. */
  fromBoard: z.string().optional(),
  /** The image this one revises, when it does. */
  revisedFrom: z.string().optional(),
  /** What the person asked the revision to change ("more spacious"). */
  instruction: z.string().optional(),
  /** For a close-up, what it shows ("the pricing table"). */
  focus: z.string().optional(),
  /**
   * The other images sent with the prompt, in order: a remix's parent mood
   * boards, then the direction's references.
   */
  sentWith: z.array(z.string()).optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  /** ISO-8601. */
  createdAt: z.string(),
});
export type SketchbookImage = z.infer<typeof SketchbookImageSchema>;

/**
 * A direction from before kinds kept its images in two lists, `boards` and
 * `mocks`; each becomes its kind in `images`, oldest first per kind.
 */
const legacyImages = (v: unknown): unknown => {
  if (!v || typeof v !== "object" || "images" in v) return v;
  const { boards, mocks, ...rest } = v as { boards?: unknown; mocks?: unknown };
  const tag = (list: unknown, kind: string) =>
    Array.isArray(list)
      ? list.map((i) => (i && typeof i === "object" && !("kind" in i) ? { ...i, kind } : i))
      : [];
  return { ...rest, images: [...tag(boards, "moodboard"), ...tag(mocks, "mock")] };
};

/**
 * The tokens an agent proposes for a direction of a Look sketchbook, read off
 * its palette, type poster and mood board: the dotted-path patch `set_theme`
 * takes, and font roles as `set_theme` declares them. The server validates it
 * by applying it to the theme the way `set_theme` would; this is only its shape.
 */
export const SketchbookProposalSchema = z.object({
  tokens: z.record(z.string(), z.union([z.string(), z.number()])).default({}),
  fonts: z
    .array(
      z.object({
        role: z.string().min(1),
        family: z.string().min(1),
        fallback: z.string().optional(),
        google: z.union([z.string(), z.literal(true)]).optional(),
      }),
    )
    .default([]),
});
export type SketchbookProposal = z.infer<typeof SketchbookProposalSchema>;

/**
 * A screenshot the person likes: uploaded or pasted, or a page the daemon
 * captured from a URL. Its image is kept under
 * `assets/sketchbook/<id>/refs/`, so it is sent to image models like any
 * sketchbook image; nothing is drawn from it but what `note` says to take.
 */
const SketchbookReferenceSchema = z.object({
  /** Slug, unique in the sketchbook; directions name it in their `references`. */
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  /** Folder-relative asset path of its image. */
  path: z.string(),
  /** The page it is a screenshot of, when it is one. */
  url: z.string().optional(),
  /** The browser capture it was taken from (`list_captures`), when it was. */
  captureId: z.string().optional(),
  /** What to take from it ("the colour and the big serif headlines"). */
  note: z.string().default(""),
  /** ISO-8601. */
  createdAt: z.string(),
});
export type SketchbookReference = z.infer<typeof SketchbookReferenceSchema>;

const DirectionObjectSchema = z.object({
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
  /** Every image drawn for it, oldest first; the last of a kind is that kind's current one. */
  images: z.array(SketchbookImageSchema).default([]),
  /** For a Look sketchbook: the tokens proposed from its images; null until proposed. */
  proposal: SketchbookProposalSchema.nullable().default(null),
  /** The sketchbook's references it is drawn from, by id: each goes to the image model. */
  references: z.array(z.string()).default([]),
  /** The two directions it remixes, when it is a remix. */
  remixOf: z.array(z.string()).default([]),
  /** What a remix takes from each ("colour from A, type and texture from B"). */
  take: z.string().default(""),
});
export const SketchbookDirectionSchema = z.preprocess(legacyImages, DirectionObjectSchema);
export type SketchbookDirection = z.infer<typeof DirectionObjectSchema>;

export const SketchbookBriefSchema = z.object({
  /** Whether the design exists already (read from the codebase) or is new. */
  origin: z.enum(["existing", "new"]),
  /** What the product is and who it is for, in a paragraph. */
  product: z.string().min(1),
  /** The page or screen being designed ("the landing page"); empty for a Look sketchbook. */
  page: z.string().default(""),
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

/**
 * A screen designed from one of the sketchbook's images. The sketchbook is the
 * only record of it: a screen's `inspiredBy` is read from these, so a deleted
 * screen leaves nothing to clean up on either side.
 */
export const SketchbookOutputSchema = z.object({
  screen: z.string(),
  direction: z.string(),
  /** The image it was built from: a mock, or a mood board. */
  image: z.string(),
  /** ISO-8601: when it was built, so an image drawn later makes it stale. */
  at: z.string(),
});
export type SketchbookOutput = z.infer<typeof SketchbookOutputSchema>;

export const SketchbookFileSchema = z.object({
  version: z.literal(1),
  /** What the person calls it; empty until named, when the brief's page stands in. */
  name: z.string().max(120).default(""),
  subject: SketchbookSubjectSchema.default("page"),
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
  /** Screenshots and captured pages the person likes, which directions are drawn from. */
  references: z.array(SketchbookReferenceSchema).default([]),
  /** The person chose to go from directions straight to mocks. */
  skipBoards: z.boolean().default(false),
  /** Mocks drawn per picked direction. */
  mockCount: z.number().int().min(1).max(6).default(2),
  /** The image model picked for each kind; absent = the cloud's default. */
  models: z.record(z.string(), z.string()).default({}),
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
  /** The screens built from its images, one record per screen. */
  outputs: z.array(SketchbookOutputSchema).default([]),
});
export type SketchbookFile = z.infer<typeof SketchbookFileSchema>;

export const EMPTY_SKETCHBOOK: SketchbookFile = SketchbookFileSchema.parse({ version: 1 });

/** The directions still in the running. */
export const activeDirections = (sketchbook: SketchbookFile): SketchbookDirection[] =>
  sketchbook.directions.filter((d) => !d.dropped);

/** What a sketchbook is called on the canvas: its name, else the page it redesigns. */
export const sketchbookName = (sketchbook: SketchbookFile): string =>
  sketchbook.name.trim() ||
  (sketchbook.subject === "look" ? "Palettes and type" : "") ||
  sketchbook.brief?.page.trim() ||
  sketchbook.page?.label ||
  (sketchbook.origin === "new" ? "Something new" : "Untitled sketchbook");

/** A direction's images of one kind, oldest first. */
export const imagesOf = (direction: SketchbookDirection, kind: string): SketchbookImage[] =>
  direction.images.filter((i) => i.kind === kind);

/** A direction's current image of a kind: the last one drawn. */
export const latestOf = (
  direction: SketchbookDirection,
  kind: string,
): SketchbookImage | undefined => direction.images.findLast((i) => i.kind === kind);

/** A direction's references, in its order, that the sketchbook still has. */
export const referencesOf = (
  sketchbook: Pick<SketchbookFile, "references">,
  direction: Pick<SketchbookDirection, "references">,
): SketchbookReference[] =>
  direction.references.flatMap((id) => sketchbook.references.filter((r) => r.id === id));

/** The image at `path` in any direction, with its direction. */
export function findSketchbookImage(
  sketchbook: Pick<SketchbookFile, "directions">,
  path: string,
): { direction: SketchbookDirection; image: SketchbookImage } | undefined {
  for (const direction of sketchbook.directions) {
    const image = direction.images.find((i) => i.path === path);
    if (image) return { direction, image };
  }
  return undefined;
}
