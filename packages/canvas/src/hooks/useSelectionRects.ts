/**
 * Where the selected node actually sits on the board.
 *
 * The highlight itself is drawn inside the iframe, which is why nothing in the
 * parent needed the geometry until now. Resize handles do: they're parent-side
 * chrome that has to land on the element's edges. The rects come from the same
 * `requestRects` round trip the comment pins use, translated out of iframe
 * coordinates by the frame's inset.
 *
 * A screen can be placed on a board more than once, so this returns every
 * placement — the selection is screen-scoped and all of them highlight.
 */

import { useMemo } from "react";
import { useCanvas } from "../store.ts";

export interface SelectionRect {
  frameId: string;
  /** Board-space box, before the world transform. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export function useSelectionRects(): SelectionRect[] {
  const selection = useCanvas((s) => s.selection);
  const board = useCanvas((s) => (s.currentBoardId ? s.boards[s.currentBoardId] : undefined));
  const nodeRects = useCanvas((s) => s.nodeRects);
  const frameInsets = useCanvas((s) => s.frameInsets);

  return useMemo(() => {
    if (!selection || !board) return [];
    const out: SelectionRect[] = [];
    for (const frame of board.frames) {
      if (frame.screen !== selection.screenId) continue;
      const rect = nodeRects[frame.id]?.[selection.path];
      if (!rect) continue;
      const inset = frameInsets[frame.id] ?? { x: 0, y: 0, chromeH: 0 };
      out.push({
        frameId: frame.id,
        x: frame.x + inset.x + rect.x,
        y: frame.y + inset.y + rect.y,
        w: rect.w,
        h: rect.h,
      });
    }
    return out;
  }, [selection, board, nodeRects, frameInsets]);
}
