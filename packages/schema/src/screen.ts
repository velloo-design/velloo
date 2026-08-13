import { z } from "zod";
import { NodeSchema } from "./node.ts";

/**
 * A Screen is one composition: a single responsive React tree built from
 * the design folder's library. Lives at `screens/<id>.json`.
 *
 * One screen → one tree. Different viewport renderings are not separate
 * screens — they're separate Frames on the Board pointing at the same
 * screen. Edits to the tree propagate to every frame of that screen.
 *
 * If a layout truly diverges per breakpoint (e.g. drawer vs sidebar nav),
 * the user/agent creates a *second* screen and a second frame. Explicit
 * fork, no background sync.
 */
export const ScreenSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  tree: NodeSchema,
});

export type Screen = z.infer<typeof ScreenSchema>;
