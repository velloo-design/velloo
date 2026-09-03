import type { StateCreator } from "zustand";
import {
  focusFrame,
  focusRect,
  MAX_ZOOM,
  MIN_ZOOM,
  type PanZoom,
  zoomAtPoint,
} from "../board-geometry.ts";
import type { CanvasState } from "./index.ts";
import type { CursorMode } from "./types.ts";

/**
 * Animated camera moves (fly-to navigation): one in-flight tween at a time,
 * cancelled by starting another or by any user-driven setPan/setCanvasZoom —
 * a wheel or drag mid-flight must win instantly, never fight the animation.
 */
let flightToken = 0;
export function cancelCameraFlight(): void {
  flightToken += 1;
}

/** Camera saved while editing an annotation/note — restored when edit ends. */
let markupEditSavedView: PanZoom | null = null;

const FLIGHT_MS = 450;
const MARKUP_EDIT_FLIGHT_MS = 280;
const easeInOutCubic = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

function animateCamera(
  set: (partial: { canvasZoom: number; pan: { x: number; y: number } }) => void,
  from: PanZoom,
  to: PanZoom,
  ms = FLIGHT_MS,
  onSettle?: () => void,
): void {
  const token = ++flightToken;
  const start = performance.now();
  const step = (now: number) => {
    if (token !== flightToken) return;
    const t = Math.min(1, (now - start) / ms);
    const k = easeInOutCubic(t);
    set({
      canvasZoom: from.zoom + (to.zoom - from.zoom) * k,
      pan: {
        x: from.pan.x + (to.pan.x - from.pan.x) * k,
        y: from.pan.y + (to.pan.y - from.pan.y) * k,
      },
    });
    if (t < 1) requestAnimationFrame(step);
    else onSettle?.();
  };
  requestAnimationFrame(step);
}

const boardWrapper = (): HTMLElement | null =>
  document.querySelector<HTMLElement>('[data-velloo-board="true"]');

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
  /**
   * Measured frame chrome, fed by a ResizeObserver in Frame.tsx: `x`/`y` are
   * the iframe's offset from the frame origin (header row above it) in
   * board-world units, `chromeH` the total vertical chrome around the iframe
   * (header + preset chips). Annotation anchoring and frame collision read
   * these instead of hardcoding the chrome layout.
   */
  frameInsets: Record<string, { x: number; y: number; chromeH: number }>;
  /**
   * One-shot node-geometry probe: the hosting Frame answers with a
   * requestRects for this path (merged into nodeRects). Drives locateNode's
   * precise fly-to targeting; nonce keyed so repeat locates re-probe.
   */
  rectProbe: { frameId: string; path: string; nonce: number } | null;

  setCanvasZoom(z: number): void;
  setCursorMode(m: CursorMode): void;
  setPan(p: { x: number; y: number }): void;
  /**
   * Zoom by `factor` (or toward an absolute zoom) anchored on the board
   * viewport center — used by keyboard / toolbar zoom so the view doesn't
   * drift toward the world origin.
   */
  zoomAtViewportCenter(opts: { factor?: number; zoom?: number }): void;
  /**
   * Soft-zoom to 100% for markup editing (annotation / note), remembering
   * the prior camera so {@link restoreViewAfterMarkupEdit} can glide back.
   */
  zoomForMarkupEdit(): void;
  restoreViewAfterMarkupEdit(): void;
  /**
   * Center a frame of the current board in the visible canvas (search
   * navigation). Reads the board wrapper's size from the DOM — a no-op when
   * no board is on screen (library / snippet view).
   */
  centerOnFrame(frameId: string): void;
  /** Animated centerOnFrame — the camera glides instead of jumping. */
  flyToFrame(frameId: string): void;
  /**
   * Navigate straight to a node: select + reveal it, then glide the camera to
   * center the node itself (zooming toward 1:1), falling back to the hosting
   * frame when its geometry can't be measured in time. Switches board first
   * when the screen lives elsewhere; `hostBoards` (e.g. an activity event's
   * server-enriched board list) covers screens on boards not loaded yet.
   */
  locateNode(screenId: string, path: string, opts?: { hostBoards?: string[] }): Promise<void>;
  setNodeRects(
    frameId: string,
    rects: { path: string; x: number; y: number; w: number; h: number }[],
  ): void;
  clearNodeRects(frameId: string): void;
  /** Pass `null` to drop the measurement when the frame unmounts. */
  setFrameInset(frameId: string, inset: { x: number; y: number; chromeH: number } | null): void;
}

export const createViewportSlice: StateCreator<CanvasState, [], [], ViewportSlice> = (
  set,
  get,
) => ({
  canvasZoom: 0.75,
  cursorMode: "select",
  pan: { x: 0, y: 0 },
  nodeRects: {},
  frameInsets: {},
  rectProbe: null,

  setCanvasZoom(canvasZoom) {
    cancelCameraFlight();
    // A camera move outside an edit session invalidates a saved markup-edit
    // view (e.g. a restore glide the user interrupted).
    if (!get().editingMarkupId) markupEditSavedView = null;
    set({ canvasZoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, canvasZoom)) });
  },

  setCursorMode(cursorMode) {
    set({ cursorMode, hover: null });
  },

  setPan(pan) {
    cancelCameraFlight();
    if (!get().editingMarkupId) markupEditSavedView = null;
    set({ pan });
  },

  zoomAtViewportCenter(opts) {
    const wrapper = boardWrapper();
    if (!wrapper) {
      if (opts.zoom !== undefined) {
        set({ canvasZoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, opts.zoom)) });
      } else if (opts.factor !== undefined) {
        const z = get().canvasZoom * opts.factor;
        set({ canvasZoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z)) });
      }
      return;
    }
    const current = { zoom: get().canvasZoom, pan: get().pan };
    const factor =
      opts.factor ?? (opts.zoom !== undefined && current.zoom > 0 ? opts.zoom / current.zoom : 1);
    const next = zoomAtPoint(wrapper.clientWidth / 2, wrapper.clientHeight / 2, factor, current);
    if (
      next.zoom === current.zoom &&
      next.pan.x === current.pan.x &&
      next.pan.y === current.pan.y
    ) {
      return;
    }
    cancelCameraFlight();
    if (!get().editingMarkupId) markupEditSavedView = null;
    set({ canvasZoom: next.zoom, pan: next.pan });
  },

  zoomForMarkupEdit() {
    const current = { zoom: get().canvasZoom, pan: get().pan };
    if (!markupEditSavedView) markupEditSavedView = current;
    if (Math.abs(current.zoom - 1) < 0.02) return;
    const wrapper = boardWrapper();
    if (!wrapper) {
      set({ canvasZoom: 1 });
      return;
    }
    const next = zoomAtPoint(
      wrapper.clientWidth / 2,
      wrapper.clientHeight / 2,
      1 / current.zoom,
      current,
    );
    animateCamera(set, current, { zoom: 1, pan: next.pan }, MARKUP_EDIT_FLIGHT_MS);
  },

  restoreViewAfterMarkupEdit() {
    const saved = markupEditSavedView;
    if (!saved) return;
    const current = { zoom: get().canvasZoom, pan: get().pan };
    if (
      Math.abs(current.zoom - saved.zoom) < 0.001 &&
      current.pan.x === saved.pan.x &&
      current.pan.y === saved.pan.y
    ) {
      markupEditSavedView = null;
      return;
    }
    // Keep the saved view until the glide settles — re-entering edit
    // mid-flight then reuses the true pre-edit camera instead of
    // snapshotting a tween frame.
    animateCamera(set, current, saved, MARKUP_EDIT_FLIGHT_MS, () => {
      markupEditSavedView = null;
    });
  },

  centerOnFrame(frameId) {
    const s = get();
    const board = s.currentBoardId ? s.boards[s.currentBoardId] : null;
    const frame = board?.frames.find((f) => f.id === frameId);
    const wrapper = boardWrapper();
    if (!frame || !wrapper) return;
    const view = focusFrame(frame, wrapper.clientWidth, wrapper.clientHeight);
    if (!view) return;
    set({ canvasZoom: view.zoom, pan: view.pan });
  },

  flyToFrame(frameId) {
    const s = get();
    const board = s.currentBoardId ? s.boards[s.currentBoardId] : null;
    const frame = board?.frames.find((f) => f.id === frameId);
    const wrapper = boardWrapper();
    if (!frame || !wrapper) return;
    const view = focusFrame(frame, wrapper.clientWidth, wrapper.clientHeight);
    if (!view) return;
    animateCamera(set, { zoom: s.canvasZoom, pan: s.pan }, view);
  },

  async locateNode(screenId, path, opts = {}) {
    const s = get();
    // Host board: stay put when the current board shows the screen, else any
    // loaded board hosting it, else the caller's hint (activity events carry
    // the server-enriched hosting-board list — the canvas can't derive it for
    // a board it never loaded, which used to blank the tree's screen picker).
    const hinted = opts.hostBoards ?? [];
    const hostBoard =
      s.currentBoardId &&
      (s.boards[s.currentBoardId]?.frames.some((f) => f.screen === screenId) ||
        hinted.includes(s.currentBoardId))
        ? s.currentBoardId
        : (Object.values(s.boards).find((b) => b.frames.some((f) => f.screen === screenId))?.id ??
          hinted.find((id) => s.design?.boards.some((b) => b.id === id)) ??
          null);
    if (hostBoard && hostBoard !== s.currentBoardId) await s.selectBoard(hostBoard);
    get().revealSelection({ screenId, path });
    const boardId = get().currentBoardId;
    const board = boardId ? get().boards[boardId] : null;
    const frame = board?.frames.find((f) => f.screen === screenId);
    if (!frame) return;

    // Probe the node's rect in the hosting frame; fall back to framing the
    // whole frame if the geometry doesn't come back in time (iframe still
    // booting, node gone).
    set((prev) => ({
      rectProbe: { frameId: frame.id, path, nonce: (prev.rectProbe?.nonce ?? 0) + 1 },
    }));
    const rect = await new Promise<{ x: number; y: number; w: number; h: number } | null>(
      (resolve) => {
        const deadline = Date.now() + 700;
        const poll = () => {
          const found = get().nodeRects[frame.id]?.[path];
          if (found && found.w > 0) return resolve(found);
          if (Date.now() > deadline) return resolve(null);
          setTimeout(poll, 60);
        };
        // Give the frame effect + iframe a beat to answer the probe.
        setTimeout(poll, 90);
      },
    );
    const wrapper = boardWrapper();
    if (!wrapper) return;
    const from = { zoom: get().canvasZoom, pan: get().pan };
    if (rect) {
      const inset = get().frameInsets[frame.id] ?? { x: 0, y: 0, chromeH: 0 };
      // Rects are iframe-viewport-relative; clamp inside the frame so a node
      // outside the fold still targets a visible point of the frame.
      const nx = frame.x + inset.x + Math.max(0, Math.min(rect.x, frame.w - rect.w));
      const ny = frame.y + inset.y + Math.max(0, Math.min(rect.y, frame.h - rect.h));
      const view = focusRect(
        { x: nx, y: ny, w: rect.w, h: rect.h },
        wrapper.clientWidth,
        wrapper.clientHeight,
      );
      if (view) animateCamera(set, from, view);
      return;
    }
    const view = focusFrame(frame, wrapper.clientWidth, wrapper.clientHeight);
    if (view) animateCamera(set, from, view);
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

  setFrameInset(frameId, inset) {
    set((s) => {
      const prev = s.frameInsets[frameId];
      if (inset === null) {
        if (!prev) return s;
        const { [frameId]: _drop, ...rest } = s.frameInsets;
        void _drop;
        return { frameInsets: rest };
      }
      if (prev && prev.x === inset.x && prev.y === inset.y && prev.chromeH === inset.chromeH) {
        return s;
      }
      return { frameInsets: { ...s.frameInsets, [frameId]: inset } };
    });
  },
});
