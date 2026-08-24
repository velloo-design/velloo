import type { StateCreator } from "zustand";
import type { CanvasState } from "./index.ts";
import type { CursorMode } from "./types.ts";

/** Camera + pointer state: zoom, pan, cursor tool, and reported frame geometry. */
export interface ViewportSlice {
  canvasZoom: number;
  cursorMode: CursorMode;
  pan: { x: number; y: number };
  /**
   * Reported by each frame's iframe runtime when the canvas asks for
   * geometry. Keyed by frameId so multi-frame screens (same tree at
   * different viewport sizes) don't clobber each other's rects.
   * Coordinates are in iframe-document space — the consumer adds the
   * frame's board-world offset to anchor in the canvas.
   */
  nodeRects: Record<string, Record<string, { x: number; y: number; w: number; h: number }>>;

  setCanvasZoom(z: number): void;
  setCursorMode(m: CursorMode): void;
  setPan(p: { x: number; y: number }): void;
  setNodeRects(
    frameId: string,
    rects: { path: string; x: number; y: number; w: number; h: number }[],
  ): void;
  clearNodeRects(frameId: string): void;
}

export const createViewportSlice: StateCreator<CanvasState, [], [], ViewportSlice> = (set) => ({
  canvasZoom: 0.75,
  cursorMode: "select",
  pan: { x: 0, y: 0 },
  nodeRects: {},

  setCanvasZoom(canvasZoom) {
    set({ canvasZoom: Math.max(0.1, Math.min(4, canvasZoom)) });
  },

  setCursorMode(cursorMode) {
    if (cursorMode === "annotate") {
      set({ cursorMode, hover: null, selection: null, nodeState: "default" });
    } else {
      set({ cursorMode, hover: null });
    }
  },

  setPan(pan) {
    set({ pan });
  },

  setNodeRects(frameId, rects) {
    set((s) => {
      const next: Record<string, { x: number; y: number; w: number; h: number }> = {};
      for (const r of rects) next[r.path] = { x: r.x, y: r.y, w: r.w, h: r.h };
      return { nodeRects: { ...s.nodeRects, [frameId]: next } };
    });
  },

  clearNodeRects(frameId) {
    set((s) => {
      if (!(frameId in s.nodeRects)) return s;
      const { [frameId]: _drop, ...rest } = s.nodeRects;
      void _drop;
      return { nodeRects: rest };
    });
  },
});
