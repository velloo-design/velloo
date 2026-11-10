import {
  ArtDirectionBriefSchema,
  ArtDirectionFileSchema,
  ArtDirectionPageSchema,
  ArtDirectionStageSchema,
} from "@velloo/schema";
import { z } from "zod";
import { ImageModelsResponseSchema } from "./cloud-api.ts";

/**
 * The art direction's wire contract: what the canvas (`/api/art-direction`) and the
 * agent (`update_art_direction`, `generate_art_direction`) send, and the state both read
 * back. One schema per write, shared by the two, so the canvas and the agent
 * can't drift into editing the art direction differently.
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
export const ART_DIRECTION_LIMITS = {
  product: 600,
  page: 120,
  content: 2800,
  notes: 400,
  description: 900,
  layout: 500,
} as const;

const limited = (field: keyof typeof ART_DIRECTION_LIMITS, what: string) =>
  z
    .string()
    .max(
      ART_DIRECTION_LIMITS[field],
      `${what} is at most ${ART_DIRECTION_LIMITS[field]} characters: every image prompt carries it`,
    );

/** The brief as it is written: the file's brief, held to the lengths a prompt can carry. */
export const BriefBodySchema = ArtDirectionBriefSchema.extend({
  product: limited("product", "The product").min(1),
  page: limited("page", "The page").min(1),
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
});
export type DirectionPatch = z.infer<typeof DirectionPatchSchema>;

export const UpdateArtDirectionBodySchema = z.object({
  stage: ArtDirectionStageSchema.optional(),
  origin: z.enum(["existing", "new"]).nullable().optional(),
  /** The page to redesign; null clears it. */
  page: ArtDirectionPageSchema.nullable().optional(),
  /** The Agent-tab session running the art direction (the canvas sets it). */
  agentSession: z.string().max(200).nullable().optional(),
  /** The whole brief; replaces the one there. */
  brief: BriefBodySchema.optional(),
  /** Upserts by id, in order. A new id needs a title and a description. */
  directions: z.array(DirectionPatchSchema).max(12).optional(),
  /** Ids to delete outright, images and all (dropping keeps them). */
  removeDirections: z.array(z.string()).optional(),
  skipBoards: z.boolean().optional(),
  mockCount: z.number().int().min(1).max(6).optional(),
  models: z.object({ moodboard: z.string().optional(), mock: z.string().optional() }).optional(),
  /** The mock the design is built from; null clears it. */
  chosen: z.object({ direction: z.string(), mock: z.string() }).nullable().optional(),
  /** Whether the build may draw the mock's images with paid generation. */
  generateImages: z.boolean().nullable().optional(),
});
export type UpdateArtDirectionBody = z.infer<typeof UpdateArtDirectionBodySchema>;

export const GenerateArtDirectionBodySchema = z.object({
  /** A mood board per direction, or mocks. */
  kind: z.enum(["moodboard", "mock"]),
  /**
   * Which directions. Default: every direction still in the running, and for
   * mocks only the picked ones.
   */
  directions: z.array(z.string()).max(12).optional(),
  /** Mocks per direction; default the art direction's `mockCount`. Mood boards are one each. */
  count: z.number().int().min(1).max(6).optional(),
  /** An image model's public id; default the art direction's pick, then the cloud's. */
  model: z.string().max(80).optional(),
});
export type GenerateArtDirectionBody = z.infer<typeof GenerateArtDirectionBodySchema>;

/** One image being drawn right now, so every open canvas can show it. */
export const ArtDirectionPendingSchema = z.object({
  direction: z.string(),
  kind: z.enum(["moodboard", "mock"]),
  count: z.number().int(),
});
export type ArtDirectionPending = z.infer<typeof ArtDirectionPendingSchema>;

/** `GET /api/art-direction`. */
export const ArtDirectionStateSchema = z.object({
  artDirection: ArtDirectionFileSchema,
  /** False until something has been written: the canvas shows how to start one. */
  started: z.boolean(),
  pending: z.array(ArtDirectionPendingSchema),
});
export type ArtDirectionState = z.infer<typeof ArtDirectionStateSchema>;

/** One generation's outcome, per image. */
export const ArtDirectionGenerateResultSchema = z.object({
  made: z.array(
    z.object({ direction: z.string(), kind: z.enum(["moodboard", "mock"]), path: z.string() }),
  ),
  failed: z.array(z.object({ direction: z.string(), message: z.string() })),
  /** What the run cost and what's left, e.g. "cost $0.06, balance $0.94". */
  cost: z.string().optional(),
});
export type ArtDirectionGenerateResult = z.infer<typeof ArtDirectionGenerateResultSchema>;

/**
 * A run's failures as one message: the same reason for every image (no credits,
 * no image provider) said once, different ones each with their direction.
 */
export function describeArtDirectionFailures(
  failed: ArtDirectionGenerateResult["failed"],
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

/** A page the art direction can redesign, offered on its start page. */
export const ArtDirectionPageOptionSchema = z.object({
  kind: z.enum(["route", "capture", "screen"]),
  page: ArtDirectionPageSchema,
  /** A second line: the source file, the captured URL. */
  detail: z.string().optional(),
});
export type ArtDirectionPageOption = z.infer<typeof ArtDirectionPageOptionSchema>;

/** `GET /api/art-direction/pages`: the app's routes, its captured pages and the canvas's screens. */
export const ArtDirectionPagesSchema = z.object({
  pages: z.array(ArtDirectionPageOptionSchema),
});
export type ArtDirectionPages = z.infer<typeof ArtDirectionPagesSchema>;

/** `GET /api/art-direction/models`; null when the daemon isn't signed in. */
export const ArtDirectionModelsSchema = ImageModelsResponseSchema.nullable();
