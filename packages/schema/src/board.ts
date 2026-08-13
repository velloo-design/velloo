import { z } from "zod";
import { FrameSchema } from "./frame.ts";

/**
 * A visual group on the Board — a colored region label that ties related
 * frames together ("marketing flow", "settings flow"). Frames carry the
 * group id; the group itself just defines name + color.
 */
export const BoardGroupSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** CSS color value; canvas uses it for the group region tint and tag chip. */
  color: z.string().optional(),
});

export type BoardGroup = z.infer<typeof BoardGroupSchema>;

/**
 * The Board is the canvas — the single top-level placement of every Frame
 * in the design folder. Persisted at `board.json` in the folder root.
 */
export const BoardSchema = z.object({
  frames: z.array(FrameSchema).default([]),
  groups: z.array(BoardGroupSchema).default([]),
});

export type Board = z.infer<typeof BoardSchema>;
