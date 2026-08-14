import type { Frame as FrameT } from "@velloo/schema";
import { useState } from "react";
import { mutate } from "../../api.ts";
import { useCanvas } from "../../store.ts";
import { toastError } from "../../toast.ts";

const FRAME_PADDING = 16;
const MIN_FRAME_SIDE = 120;

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
 * Resize is clamped against every neighboring frame so two frames never
 * overlap. The clamp is conservative — it shrinks against the *current*
 * neighbor edges; it does not push neighbors out of the way.
 */
export function useFrameInteractions({ boardId, frame, otherFrames }: UseFrameInteractionsArgs) {
  const [draftSize, setDraftSize] = useState<{ w: number; h: number } | null>(null);
  const [draftPos, setDraftPos] = useState<{ x: number; y: number } | null>(null);

  const clampResize = (nextW: number, nextH: number): { w: number; h: number } => {
    let cw = nextW;
    let ch = nextH;
    for (const other of otherFrames) {
      const ox1 = other.x;
      const oy1 = other.y;
      const ox2 = other.x + other.w;
      const oy2 = other.y + other.h;
      if (oy1 < frame.y + ch && oy2 > frame.y && ox1 >= frame.x + frame.w - 1) {
        const maxW = ox1 - frame.x - FRAME_PADDING;
        if (maxW < cw) cw = maxW;
      }
      if (ox1 < frame.x + cw && ox2 > frame.x && oy1 >= frame.y + frame.h - 1) {
        const maxH = oy1 - frame.y - FRAME_PADDING;
        if (maxH < ch) ch = maxH;
      }
    }
    return { w: Math.max(MIN_FRAME_SIDE, cw), h: Math.max(MIN_FRAME_SIDE, ch) };
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

    const compute = (ev: PointerEvent) => {
      const dx = (ev.clientX - startX) / zoom;
      const dy = (ev.clientY - startY) / zoom;
      const rawW = direction === "s" ? startW : Math.round(startW + dx);
      const rawH = direction === "e" ? startH : Math.round(startH + dy);
      return clampResize(rawW, rawH);
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

    const compute = (ev: PointerEvent) => {
      const dx = (ev.clientX - startPx) / zoom;
      const dy = (ev.clientY - startPy) / zoom;
      return { x: Math.round(startX + dx), y: Math.round(startY + dy) };
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
