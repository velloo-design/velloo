import { z } from "zod";
import { FrameSchema } from "./frame.ts";
import { ResourceIdSchema } from "./ids.ts";

/**
 * A visual group on a Board — a colored region label that ties related
 * frames together ("marketing flow", "settings flow"). Frames carry the
 * group id; the group itself just defines name + color.
 */
export const BoardGroupSchema = z.object({
  id: ResourceIdSchema,
  name: z.string().min(1),
  /** CSS color value; canvas uses it for the group region tint and tag chip. */
  color: z.string().optional(),
});

export type BoardGroup = z.infer<typeof BoardGroupSchema>;

/**
 * A Board is one infinite canvas with its own collection of frames + groups.
 * A design folder has many Boards (one per "flow" — onboarding, settings,
 * pricing, etc.). Each Board persists as `boards/<id>.json`.
 *
 * Frames within a Board reference Screens by id. The same Screen can appear
 * in multiple Boards (and multiple frames within a single Board); edits to
 * the underlying screen propagate to every frame everywhere.
 */
export const BoardSchema = z.object({
  id: ResourceIdSchema,
  name: z.string().min(1),
  /**
   * Named theme (stem of `theme/<name>.json`) the canvas applies when
   * rendering this board's frames. Absent = the folder default. Lets
   * candidate boards carry their own palette/typography side by side —
   * mirroring the per-screen `library` twin pattern.
   */
  theme: z.string().min(1).optional(),
  frames: z.array(FrameSchema).default([]),
  groups: z.array(BoardGroupSchema).default([]),
});

export type Board = z.infer<typeof BoardSchema>;
