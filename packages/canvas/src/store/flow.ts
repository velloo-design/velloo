import type { Board, FlowEdge } from "@velloo/schema";
import type { StateCreator } from "zustand";
import { mutate } from "../api.ts";
import type { FlowBox } from "../flow-geometry.ts";
import { toastError } from "../toast.ts";
import type { CanvasState } from "./index.ts";

/** An arrow is named by the pair of frames it joins. */
export interface FlowEdgeRef {
  from: string;
  to: string;
}

export const sameFlowEdge = (a: FlowEdgeRef | null, b: FlowEdgeRef | null): boolean =>
  a !== null && b !== null && a.from === b.from && a.to === b.to;

/** What one `connectFrames` entry may say; mirrors the server's entry. */
interface FlowEdgeChange extends FlowEdgeRef {
  label?: string | null;
  state?: string | null;
  remove?: boolean;
}

/**
 * Where a frame's rendered screen sits on the board: the frame's origin plus
 * the measured header above it, and wherever a drag in progress has taken it.
 * Arrows attach to this box, not to the frame's chrome.
 */
export function flowBoxes(
  state: Pick<CanvasState, "frameInsets" | "frameDrafts" | "canvasZoom">,
  board: Pick<Board, "frames">,
): Array<FlowBox & { id: string }> {
  const zoom = state.canvasZoom || 1;
  return board.frames.map((frame) => {
    const inset = state.frameInsets[frame.id] ?? { x: 0, y: 0 };
    const at = state.frameDrafts[frame.id] ?? frame;
    return {
      id: frame.id,
      x: at.x + inset.x,
      y: at.y + inset.y,
      w: at.w,
      h: at.h,
      // The header row is `inset.y` tall in layout and counter-scaled against
      // the zoom, so that is how much board it covers above the screen.
      head: inset.y / zoom,
    };
  });
}

/** The arrows between a board's frames: the drag that draws one, and the one being edited. */
export interface FlowSlice {
  /**
   * Position and size of a frame mid-drag or mid-resize. The gesture's own
   * draft lives in the Frame (so only that frame re-renders per tick); this
   * mirror exists so the frame's arrows can follow it before the write lands.
   */
  frameDrafts: Record<string, FlowBox>;
  /** An arrow being dragged out of `from`, with the pointer's board position. */
  flowDraft: { from: string; x: number; y: number } | null;
  /** The arrow whose editor is open. */
  activeFlowEdge: FlowEdgeRef | null;

  setFrameDraft(frameId: string, box: FlowBox | null): void;
  setFlowDraft(draft: { from: string; x: number; y: number } | null): void;
  setActiveFlowEdge(edge: FlowEdgeRef | null): void;
  /**
   * Draw, edit or erase arrows on the current board. The server answers with
   * the board's arrows after the write, which land in the store at once — the
   * watcher's refresh then finds nothing left to change.
   */
  connectFrames(edges: FlowEdgeChange[]): Promise<FlowEdge[] | null>;
}

export const createFlowSlice: StateCreator<CanvasState, [], [], FlowSlice> = (set, get) => ({
  frameDrafts: {},
  flowDraft: null,
  activeFlowEdge: null,

  setFrameDraft(frameId, box) {
    set((s) => {
      if (box === null) {
        if (!(frameId in s.frameDrafts)) return s;
        const { [frameId]: _dropped, ...rest } = s.frameDrafts;
        return { frameDrafts: rest };
      }
      return { frameDrafts: { ...s.frameDrafts, [frameId]: box } };
    });
  },

  setFlowDraft(flowDraft) {
    set({ flowDraft });
  },

  setActiveFlowEdge(activeFlowEdge) {
    set({ activeFlowEdge });
  },

  async connectFrames(edges) {
    const boardId = get().currentBoardId;
    if (!boardId) return null;
    try {
      const result = await mutate.connectFrames({ boardId, edges });
      set((s) => {
        const board = s.boards[boardId];
        if (!board) return s;
        const { edges: _previous, ...rest } = board;
        const next: Board = result.edges.length > 0 ? { ...rest, edges: result.edges } : rest;
        return { boards: { ...s.boards, [boardId]: next } };
      });
      // The arrow being edited may be the one this write erased.
      const active = get().activeFlowEdge;
      if (active && !result.edges.some((edge) => sameFlowEdge(edge, active))) {
        set({ activeFlowEdge: null });
      }
      return result.edges;
    } catch (err) {
      toastError(err, "Could not update the flow");
      return null;
    }
  },
});
