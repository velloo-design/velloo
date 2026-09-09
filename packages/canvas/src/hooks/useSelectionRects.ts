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
 *
 * While a snippet is focused the selection addresses the *definition*
 * (`snippet:<id>`), which no frame's `screen` ever equals — so the rects come
 * from the parallel snippet map instead, one per rendered instance. Without
 * that branch a snippet selection matched no frame at all and the grips never
 * drew, even though the ring did.
 */

import { useMemo } from "react";
import { useCanvas } from "../store.ts";

export interface SelectionRect {
  frameId: string;
  /** Distinguishes several instances of one snippet definition in one frame. */
  key: string;
  /** Board-space box, before the world transform. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** The instance the selection was made from — the only one to carry grips. */
  anchor: boolean;
  /**
   * The frame's iframe viewport in board space. Rects are measured relative to
   * that viewport, so a node scrolled out of it reports a box outside the
   * frame — chrome drawn from it would float over the board. Consumers clip.
   */
  clip: { x: number; y: number; w: number; h: number };
}

export function useSelectionRects(): SelectionRect[] {
  const selection = useCanvas((s) => s.selection);
  const board = useCanvas((s) => (s.currentBoardId ? s.boards[s.currentBoardId] : undefined));
  const nodeRects = useCanvas((s) => s.nodeRects);
  const snippetRects = useCanvas((s) => s.snippetRects);
  const snippetFocus = useCanvas((s) => s.snippetFocus);
  const anchor = useCanvas((s) => s.selectionAnchor);
  const frameInsets = useCanvas((s) => s.frameInsets);

  return useMemo(() => {
    if (!selection || !board) return [];
    const inSnippet = snippetFocus !== null && selection.screenId === `snippet:${snippetFocus}`;
    const out: SelectionRect[] = [];
    for (const frame of board.frames) {
      const boxes = inSnippet
        ? (snippetRects[frame.id]?.[selection.path] ?? [])
        : frame.screen === selection.screenId
          ? [nodeRects[frame.id]?.[selection.path]]
          : [];
      const inset = frameInsets[frame.id] ?? { x: 0, y: 0, chromeH: 0 };
      const clip = { x: frame.x + inset.x, y: frame.y + inset.y, w: frame.w, h: frame.h };
      boxes.forEach((rect, i) => {
        if (!rect) return;
        out.push({
          frameId: frame.id,
          key: `${frame.id}:${i}`,
          x: clip.x + rect.x,
          y: clip.y + rect.y,
          w: rect.w,
          h: rect.h,
          // A plain node selection has one box, which is its own anchor. A
          // snippet selection anchors to the instance that was clicked; with
          // no anchor recorded (a tree or search selection) the first instance
          // takes the grips so there is always somewhere to grab.
          anchor: !inSnippet
            ? true
            : anchor
              ? anchor.frameId === frame.id && anchor.instance === i
              : out.length === 0,
          clip,
        });
      });
    }
    return out;
  }, [selection, board, nodeRects, snippetRects, snippetFocus, anchor, frameInsets]);
}
