import type { Frame as FrameT } from "@velloo/schema";
import { useState } from "react";
import { mutate } from "../../api.ts";
import { useCanvas } from "../../store.ts";
import { toastError } from "../../toast.ts";
import {
  clampResizeToNeighbors,
  MIN_FRAME_SIDE,
  type Rect,
  resolveMoveCollision,
} from "./collision.ts";

/**
 * Fallback for a frame whose chrome hasn't been measured yet: header row
 * (~20 incl. gap) + preset chips row (~24). The ResizeObserver in Frame.tsx
 * reports the real value into `frameInsets`.
 */
const DEFAULT_CHROME_H = 44;

type ResizeDirection = "e" | "s" | "se";

interface UseFrameInteractionsArgs {
  boardId: string;
  frame: FrameT;
  otherFrames: FrameT[];
}

/**
 * Drag-to-move + edge/corner resize for a single frame. Holds a "draft"
 * position/size in state during the gesture (so the iframe doesn't
 * thrash through `updateFrame` every pointer-move) and commits to the
 * server on pointer-up.
 *
 * Both gestures respect neighbors, working on "occupied" rects (schema rect +
 * measured chrome height, see collision.ts): resize expands freely until the
 * draft actually touches a neighbor, and a move resolves collisions by
 * nudging the dragged frame flush against whatever it hit — neighbors are
 * never displaced, and a drop can't silently overlap.
 */
export function useFrameInteractions({ boardId, frame, otherFrames }: UseFrameInteractionsArgs) {
  const [draftSize, setDraftSize] = useState<{ w: number; h: number } | null>(null);
  const [draftPos, setDraftPos] = useState<{ x: number; y: number } | null>(null);

  /** Occupied rects, captured once per gesture — frames don't move mid-gesture. */
  const captureNeighbors = (): { chromeH: number; neighbors: Rect[] } => {
    const insets = useCanvas.getState().frameInsets;
    const chromeOf = (f: FrameT) => insets[f.id]?.chromeH ?? DEFAULT_CHROME_H;
    return {
      chromeH: chromeOf(frame),
      neighbors: otherFrames.map((f) => ({ x: f.x, y: f.y, w: f.w, h: f.h + chromeOf(f) })),
    };
  };

  const startResize = (direction: ResizeDirection) => (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const startW = frame.w;
    const startH = frame.h;
    const startX = e.clientX;
    const startY = e.clientY;
    const zoom = useCanvas.getState().canvasZoom || 1;
    const { chromeH, neighbors } = captureNeighbors();
    const startRect: Rect = { x: frame.x, y: frame.y, w: frame.w, h: frame.h + chromeH };

    const compute = (ev: PointerEvent) => {
      const dx = (ev.clientX - startX) / zoom;
      const dy = (ev.clientY - startY) / zoom;
      const rawW = direction === "s" ? startW : Math.max(MIN_FRAME_SIDE, Math.round(startW + dx));
      const rawH = direction === "e" ? startH : Math.max(MIN_FRAME_SIDE, Math.round(startH + dy));
      const clamped = clampResizeToNeighbors(startRect, neighbors, rawW, rawH + chromeH);
      return { w: clamped.w, h: clamped.h - chromeH };
    };

    const onMove = (ev: PointerEvent) => setDraftSize(compute(ev));
    const onUp = (ev: PointerEvent) => {
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
      target.removeEventListener("pointercancel", onUp);
      const next = compute(ev);
      setDraftSize(null);
      if (next.w !== startW || next.h !== startH) {
        void mutate
          .updateFrame({ boardId, frameId: frame.id, patch: { w: next.w, h: next.h } })
          .catch((err) => toastError(err, "Could not resize frame"));
      }
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
    target.addEventListener("pointercancel", onUp);
  };

  const startDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const startX = frame.x;
    const startY = frame.y;
    const startPx = e.clientX;
    const startPy = e.clientY;
    const zoom = useCanvas.getState().canvasZoom || 1;
    const { chromeH, neighbors } = captureNeighbors();
    const size = { w: frame.w, h: frame.h + chromeH };

    const compute = (ev: PointerEvent) => {
      const dx = (ev.clientX - startPx) / zoom;
      const dy = (ev.clientY - startPy) / zoom;
      return resolveMoveCollision(
        size,
        neighbors,
        { x: Math.round(startX + dx), y: Math.round(startY + dy) },
        { x: startX, y: startY },
      );
    };

    const onMove = (ev: PointerEvent) => setDraftPos(compute(ev));
    const onUp = (ev: PointerEvent) => {
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
      target.removeEventListener("pointercancel", onUp);
      const next = compute(ev);
      setDraftPos(null);
      if (next.x !== startX || next.y !== startY) {
        void mutate
          .updateFrame({ boardId, frameId: frame.id, patch: { x: next.x, y: next.y } })
          .catch((err) => toastError(err, "Could not move frame"));
      }
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
    target.addEventListener("pointercancel", onUp);
  };

  return {
    draftPos,
    draftSize,
    startDrag,
    startResize,
  };
}
