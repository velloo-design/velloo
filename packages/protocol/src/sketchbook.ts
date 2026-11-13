import {
  SketchbookBriefSchema,
  SketchbookChoiceSchema,
  SketchbookFileSchema,
  SketchbookOutputSchema,
  SketchbookPageSchema,
  SketchbookProposalSchema,
  SketchbookStageSchema,
  SketchbookSubjectSchema,
} from "@velloo/schema";
import { z } from "zod";
import { ImageModelsResponseSchema, IntentPriceSchema } from "./cloud-api.ts";

/**
 * The sketchbook's wire contract: what the canvas (`/api/sketchbook`) and the
 * agent (`update_sketchbook`, `generate_sketchbook`) send, and the state both read
 * back. One schema per write, shared by the two, so the canvas and the agent
 * can't drift into editing the sketchbook differently.
 */

const slug = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/, "a lowercase slug: letters, digits and dashes");

/**
 * How long each piece of the brief and of a direction may be. Together they
 * keep the longest prompt an image model is sent (a mock drawn from words
 * alone) under the cloud's 6,000 characters, with room for the wording around
 * them; a test holds the sum to that.
 */
export const SKETCHBOOK_LIMITS = {
  product: 600,
  page: 120,
  content: 2800,
  notes: 400,
  description: 900,
  layout: 500,
  /** A revision's ask ("more spacious"); it rides with the copy, as the layout does. */
  instruction: 400,
  /** What a close-up shows ("the pricing table"); it rides with the layout. */
  focus: 200,
} as const;

const limited = (field: keyof typeof SKETCHBOOK_LIMITS, what: string) =>
  z
    .string()
    .max(
      SKETCHBOOK_LIMITS[field],
      `${what} is at most ${SKETCHBOOK_LIMITS[field]} characters: every image prompt carries it`,
    );

/**
 * The brief as it is written: the file's brief, held to the lengths a prompt
 * can carry. `page` is required of a page sketchbook only, which the server
 * checks against the subject.
 */
export const BriefBodySchema = SketchbookBriefSchema.extend({
  product: limited("product", "The product").min(1),
  page: limited("page", "The page").default(""),
  content: limited(
    "content",
    "The copy (keep every heading, button and label; shorten long paragraphs and lists)",
  ).default(""),
  notes: limited("notes", "The notes").default(""),
});

/** A direction to add (`title` + `description` required) or change by id. */
export const DirectionPatchSchema = z.object({
  id: slug,
  title: z.string().min(1).max(80).optional(),
  description: limited("description", "A direction's look").min(1).optional(),
  layout: limited("layout", "A direction's layout").optional(),
  dropped: z.boolean().optional(),
  picked: z.boolean().optional(),
  /**
   * A Look sketchbook's proposed tokens: `tokens` in set_theme's dotted-path
   * form, `fonts` as set_theme declares them (Google Fonts). Null clears it.
   */
  proposal: SketchbookProposalSchema.nullable().optional(),
});
export type DirectionPatch = z.infer<typeof DirectionPatchSchema>;

export const UpdateSketchbookBodySchema = z.object({
  stage: SketchbookStageSchema.optional(),
  name: z.string().max(120).optional(),
  /** "look" explores a Look on its own (palettes, type, then tokens); "page" a page. */
  subject: SketchbookSubjectSchema.optional(),
  origin: z.enum(["existing", "new"]).nullable().optional(),
  /** The page to redesign; null clears it. */
  page: SketchbookPageSchema.nullable().optional(),
  /** The Agent-tab session running the sketchbook (the canvas sets it). */
  agentSession: z.string().max(200).nullable().optional(),
  /** The whole brief; replaces the one there. */
  brief: BriefBodySchema.optional(),
  /** Upserts by id, in order. A new id needs a title and a description. */
  directions: z.array(DirectionPatchSchema).max(12).optional(),
  /** Ids to delete outright, images and all (dropping keeps them). */
  removeDirections: z.array(z.string()).optional(),
  skipBoards: z.boolean().optional(),
  mockCount: z.number().int().min(1).max(6).optional(),
  /** The image model per kind ("mock": "velloo-study"), merged into the picks there. */
  models: z.record(z.string(), z.string()).optional(),
  /** The images (mocks or mood boards) the screens are designed from, one each; [] clears them. */
  chosen: z.array(SketchbookChoiceSchema).max(12).optional(),
  /** Whether the build may draw the mock's images with paid generation. */
  generateImages: z.boolean().nullable().optional(),
  /** Screens built from its images, recorded (or rebuilt) by screen. */
  outputs: z
    .array(z.object({ screen: z.string().min(1), image: z.string().min(1) }))
    .max(12)
    .optional(),
});
export type UpdateSketchbookBody = z.infer<typeof UpdateSketchbookBodySchema>;

const kindArg = z.string().min(1).max(40);

export const GenerateSketchbookBodySchema = z.object({
  /**
   * What to draw, one of the kinds the cloud lists (`get_sketchbook`'s
   * `kinds`): moodboard, mock, and on a current cloud palette, typeposter,
   * uikit, imagery, icons, mobile, detail.
   */
  kind: kindArg,
  /** One of the kind's aspects ("3:2"); default the kind's own. */
  aspect: z.string().max(10).optional(),
  /** For `detail`: what the close-up shows; default the page's hero. */
  focus: limited("focus", "A close-up's focus").optional(),
  /**
   * Which directions. Default: every direction still in the running, and for
   * mocks only the picked ones.
   */
  directions: z.array(z.string()).max(12).optional(),
  /** Images per direction; default the sketchbook's `mockCount` for mocks and revisions, else one. */
  count: z.number().int().min(1).max(6).optional(),
  /** An image model's public id; default the sketchbook's pick, then the cloud's. */
  model: z.string().max(80).optional(),
  /**
   * Redraw one page image with a change ("more spacious"): the image goes to
   * the model as the one to revise, and `count` new versions land beside it.
   * `mock` names it (a mock, mobile mock or close-up), `kind` is its kind, and
   * the direction is its own.
   */
  revise: z
    .object({
      mock: z.string().min(1),
      instruction: limited("instruction", "A revision's ask").min(1),
    })
    .optional(),
});
export type GenerateSketchbookBody = z.infer<typeof GenerateSketchbookBodySchema>;

/** One image being drawn right now, so every open canvas can show it. */
export const SketchbookPendingSchema = z.object({
  direction: z.string(),
  kind: z.string(),
  count: z.number().int(),
});
export type SketchbookPending = z.infer<typeof SketchbookPendingSchema>;

/**
 * Hand the chosen images to the agent to design screens from: the board they
 * go on is made, if it isn't there.
 */
export const BuildSketchbookBodySchema = z.object({
  chosen: z.array(SketchbookChoiceSchema).min(1).max(12),
  generateImages: z.boolean(),
  /** Send each chosen mock with the mood board it was drawn from. */
  withBoards: z.boolean().default(true),
  /** Extra guidance from the person, sent to the agent with the build. */
  instructions: z.string().max(2000).default(""),
});
export type BuildSketchbookBody = z.infer<typeof BuildSketchbookBodySchema>;

/** One colour pair of a proposal, scored as `score_theme_contrast` scores a theme's. */
export const ContrastPairSchema = z.object({
  label: z.string(),
  mode: z.enum(["light", "dark"]),
  fg: z.string(),
  bg: z.string(),
  ratio: z.number(),
  tier: z.enum(["AAA", "AA", "AAlarge", "Fail"]),
});
export type ContrastPair = z.infer<typeof ContrastPairSchema>;

/**
 * `GET /api/sketchbook/proposal?sketchbook=&direction=`: a direction's proposal
 * applied to the design's theme in memory, scored. `problem` when it no longer
 * applies (a token the theme lost).
 */
export const ProposalCheckSchema = z.object({
  contrast: z.array(ContrastPairSchema),
  problem: z.string().optional(),
});
export type ProposalCheck = z.infer<typeof ProposalCheckSchema>;

/** One sketchbook in the design's list. */
export const SketchbookSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  subject: SketchbookSubjectSchema,
  stage: SketchbookStageSchema,
  updatedAt: z.string().optional(),
  agentSession: z.string().nullable(),
  buildBoard: z.string().nullable(),
  /** The newest image, to show it by. */
  cover: z.string().optional(),
  directions: z.number().int(),
  images: z.number().int(),
});
export type SketchbookSummary = z.infer<typeof SketchbookSummarySchema>;

/** `GET /api/sketchbook`: every sketchbook, the most recently changed first. */
export const SketchbookListSchema = z.object({
  sketchbooks: z.array(SketchbookSummarySchema),
});
export type SketchbookList = z.infer<typeof SketchbookListSchema>;

/** `GET /api/sketchbook/state?id=`. */
export const SketchbookStateSchema = z.object({
  id: z.string(),
  sketchbook: SketchbookFileSchema,
  pending: z.array(SketchbookPendingSchema),
  /**
   * The longest prompt each kind of image would be sent with as things
   * stand, so a model that takes fewer characters can be told apart before a
   * draw rather than refused during one.
   */
  promptChars: z.record(z.string(), z.number().int()),
});
export type SketchbookState = z.infer<typeof SketchbookStateSchema>;

/**
 * Where a screen came from: the sketchbook output that names it, read from the
 * sketchbooks rather than stored on the screen. `stale` when the direction drew
 * an image of the same kind after the screen was built (a new mood board, a
 * new mock, or a revision of the one it was built from); `newer` is the newest
 * of them, what Recompose builds from.
 */
export const ScreenInspirationSchema = SketchbookOutputSchema.extend({
  sketchbook: z.string(),
  /** The sketchbook's name and the direction's title, as the canvas shows them. */
  name: z.string(),
  directionTitle: z.string(),
  stale: z.boolean(),
  newer: z.string().optional(),
});
export type ScreenInspiration = z.infer<typeof ScreenInspirationSchema>;

/** A sketchbook a board came from, through its screens, its Look or being its build board. */
export const BoardInspirationSchema = z.object({
  sketchbook: z.string(),
  name: z.string(),
  /** The direction to open it at, when one is known. */
  direction: z.string().optional(),
  /** The step that shows its first image: mocks, or the mood boards. */
  step: z.enum(["boards", "mocks"]),
  /** The images its screens (or its Look) came from, a few at most. */
  images: z.array(z.string()),
});
export type BoardInspiration = z.infer<typeof BoardInspirationSchema>;

/** `GET /api/sketchbook/links`: every link between the sketchbooks and the boards. */
export const SketchbookLinksSchema = z.object({
  screens: z.record(z.string(), ScreenInspirationSchema),
  boards: z.record(z.string(), z.array(BoardInspirationSchema)),
  /** The boards whose Look carries more than tokens, by board id: they can be restyled. */
  looks: z.record(z.string(), z.string()),
});
export type SketchbookLinks = z.infer<typeof SketchbookLinksSchema>;

/** One generation's outcome, per image. */
export const SketchbookGenerateResultSchema = z.object({
  made: z.array(z.object({ direction: z.string(), kind: z.string(), path: z.string() })),
  failed: z.array(z.object({ direction: z.string(), message: z.string() })),
  /** What the run cost and what's left, e.g. "cost 60 credits, balance 940 credits". */
  cost: z.string().optional(),
});
export type SketchbookGenerateResult = z.infer<typeof SketchbookGenerateResultSchema>;

/**
 * A run's failures as one message: the same reason for every image (no credits,
 * no image provider) said once, different ones each with their direction.
 */
export function describeSketchbookFailures(
  failed: SketchbookGenerateResult["failed"],
  titleOf: (direction: string) => string = (d) => d,
): string {
  const byMessage = new Map<string, string[]>();
  for (const f of failed)
    byMessage.set(f.message, [...(byMessage.get(f.message) ?? []), f.direction]);
  if (byMessage.size === 1) return [...byMessage.keys()][0] ?? "";
  return [...byMessage]
    .map(
      ([message, ds]) =>
        `${
          ds
            .filter((d) => d !== "*")
            .map(titleOf)
            .join(", ") || "All"
        }: ${message}`,
    )
    .join("\n");
}

/** A page the sketchbook can redesign, offered on its start page. */
export const SketchbookPageOptionSchema = z.object({
  kind: z.enum(["route", "capture", "screen"]),
  page: SketchbookPageSchema,
  /** A second line: the source file, the captured URL. */
  detail: z.string().optional(),
});
export type SketchbookPageOption = z.infer<typeof SketchbookPageOptionSchema>;

/** `GET /api/sketchbook/pages`: the app's routes, its captured pages and the canvas's screens. */
export const SketchbookPagesSchema = z.object({
  pages: z.array(SketchbookPageOptionSchema),
});
export type SketchbookPages = z.infer<typeof SketchbookPagesSchema>;

/** `GET /api/sketchbook/models`; null when the daemon isn't signed in. */
export const SketchbookModelsSchema = ImageModelsResponseSchema.nullable();

/** What each kind is called where the cloud doesn't say: an older cloud, or none. */
export const SKETCHBOOK_KIND_LABELS: Record<string, string> = {
  moodboard: "Mood board",
  mock: "Page mock",
  palette: "Palette in context",
  typeposter: "Type poster",
  uikit: "UI kit sheet",
  imagery: "Imagery style",
  icons: "Icons and motifs",
  mobile: "Mobile mock",
  detail: "Detail close-up",
};

/**
 * The kinds of image a direction can be drawn as: the cloud's `sketchbook`
 * intents that Velloo has a prompt for. `listed` is false when the cloud
 * didn't list them (one from before kinds, or unreachable), and the two it
 * always drew stand in.
 */
export const SketchbookKindsSchema = z.object({
  kinds: z.array(IntentPriceSchema),
  listed: z.boolean(),
});
export type SketchbookKinds = z.infer<typeof SketchbookKindsSchema>;

/** The label a kind is shown with. */
export const kindLabel = (
  kind: string,
  kinds?: readonly { intent: string; label?: string | undefined }[],
) => kinds?.find((k) => k.intent === kind)?.label ?? SKETCHBOOK_KIND_LABELS[kind] ?? kind;
