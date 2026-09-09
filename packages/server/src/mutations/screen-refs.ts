import type { DesignFolder } from "../design-folder.ts";

/**
 * Screens the given board places that no *other* board places. Archived
 * boards count as placements — the board is still on disk and restorable, so
 * a screen it frames isn't stranded.
 *
 * The board→screen reference is one-way, so a screen no board frames is
 * unreachable from the canvas entirely: it can't be opened, exported, or
 * published, and nothing surfaces it. That's what `remove_board` uses this
 * for, and it's the counterpart to `remove_screen`'s cascade the other way.
 *
 * Returned in frame order, deduplicated. Ids without a screen file (a frame
 * pointing at a screen that's already gone) are skipped.
 */
export function screensPlacedOnlyOn(folder: DesignFolder, boardId: string): string[] {
  const board = folder.boards.get(boardId);
  if (!board) return [];
  const elsewhere = new Set<string>();
  for (const [otherId, other] of folder.boards) {
    if (otherId === boardId) continue;
    for (const frame of other.frames) elsewhere.add(frame.screen);
  }
  const only = new Set<string>();
  for (const frame of board.frames) {
    if (elsewhere.has(frame.screen)) continue;
    if (!folder.screens.has(frame.screen)) continue;
    only.add(frame.screen);
  }
  return [...only];
}
