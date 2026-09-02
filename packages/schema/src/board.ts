import { z } from "zod";
import { FrameSchema } from "./frame.ts";
import { ResourceIdSchema } from "./ids.ts";

/**
 * A colored, named container. Used at two levels, same shape both times:
 * `config.boardGroups` holds the sidebar's groups of *boards* (an area of
 * work — "Side pane", "Account page") and `Board.groups` holds a board's
 * regions of *frames*. The member carries the group id (`Board.group`,
 * `Frame.group`); the group itself only defines name + color.
 */
export const BoardGroupSchema = z.object({
  id: ResourceIdSchema,
  name: z.string().min(1),
  /** CSS color value; canvas uses it for the group region tint and tag chip. */
  color: z.string().optional(),
});

export type BoardGroup = z.infer<typeof BoardGroupSchema>;

/**
 * Cap on board names, enforced at the mutation boundary (add/update), not
 * here in the on-disk schema — a pre-existing folder with a longer name
 * must still load. Ids are safe regardless (slugify caps them at 48).
 */
export const MAX_BOARD_NAME_LENGTH = 80;

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
  /**
   * ISO timestamp of when the board was archived. **Presence is the state** —
   * there is no `archived: false` twin to contradict it. Archived boards drop
   * out of the sidebar, `/api/design`, `list_boards`, and a default publish,
   * but stay on disk untouched and fully editable; archive is not lock.
   * Absent ⇒ active, so existing folders are unaffected.
   */
  archivedAt: z.string().datetime().optional(),
  /**
   * Id of the `config.boardGroups` entry this board is filed under — the
   * sidebar section it appears in. Absent ⇒ Ungrouped, which is also every
   * existing folder, so grouping is additive.
   */
  group: z.string().min(1).optional(),
  frames: z.array(FrameSchema).default([]),
  /** Frame regions within this board (see {@link BoardGroupSchema}). */
  groups: z.array(BoardGroupSchema).default([]),
});

export type Board = z.infer<typeof BoardSchema>;

/** Archived state is the presence of `archivedAt` — never a separate boolean. */
export function isArchived(board: Pick<Board, "archivedAt">): boolean {
  return board.archivedAt !== undefined;
}
