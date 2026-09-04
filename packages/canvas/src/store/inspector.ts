import type { StateCreator } from "zustand";
import type { CanvasState } from "./index.ts";
import type { NodeState, RightTab } from "./types.ts";

/** Right-panel inspector state: active tab + the previewed interaction state. */
export interface InspectorSlice {
  rightTab: RightTab;
  nodeState: NodeState;
  /**
   * Whether the face browser has taken over the right pane. Opened from the
   * HUD's Font control, but it lives in the pane rather than a dialog because
   * the point of browsing is watching the board re-face behind it.
   */
  browsingFaces: boolean;

  setRightTab(t: RightTab): void;
  setNodeState(s: NodeState): void;
  setBrowsingFaces(on: boolean): void;
}

export const createInspectorSlice: StateCreator<CanvasState, [], [], InspectorSlice> = (set) => ({
  rightTab: "node",
  nodeState: "default",
  browsingFaces: false,

  setRightTab(rightTab) {
    set({ rightTab });
  },

  setNodeState(nodeState) {
    set({ nodeState });
  },

  setBrowsingFaces(browsingFaces) {
    set({ browsingFaces });
  },
});
