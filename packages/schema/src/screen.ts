import { z } from "zod";
import { ResourceIdSchema } from "./ids.ts";
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
  id: ResourceIdSchema,
  name: z.string().min(1),
  /**
   * Library id (key in `Config.libraries`) this screen renders against.
   * Optional — when absent the folder's `defaultLibrary` is used.
   * Multi-library per folder; one library per screen. A screen's
   * components and extensions resolve against this library's registry.
   */
  library: z.string().min(1).optional(),
  tree: NodeSchema,
});

export type Screen = z.infer<typeof ScreenSchema>;
