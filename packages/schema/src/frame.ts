import { z } from "zod";
import { ResourceIdSchema } from "./ids.ts";

/**
 * A Frame is a placement of a Screen on the Board: position, size, optional
 * label, optional group. Multiple frames can reference the same screen at
 * different sizes — edits to that screen's tree update every frame that
 * shows it. The canvas renders visual linkage so siblings are obvious.
 *
 * Frames are freely resizable on the canvas. Snap-to-viewport-preset is a
 * UI affordance; the underlying w/h is just a number.
 */
export const FrameSchema = z.object({
  id: ResourceIdSchema,
  /** The Screen id this frame renders. */
  screen: z.string().min(1),
  x: z.number(),
  y: z.number(),
  w: z.number().int().positive(),
  h: z.number().int().positive(),
  /** Optional human label shown above the frame on the canvas. */
  label: z.string().optional(),
  /** Optional BoardGroup id. */
  group: z.string().optional(),
});

export type Frame = z.infer<typeof FrameSchema>;
