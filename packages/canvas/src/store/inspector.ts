import type { StateCreator } from "zustand";
import type { CanvasState } from "./index.ts";
import type { NodeState, RightTab } from "./types.ts";

/** Right-panel inspector state: active tab + the previewed interaction state. */
export interface InspectorSlice {
  rightTab: RightTab;
  nodeState: NodeState;

  setRightTab(t: RightTab): void;
  setNodeState(s: NodeState): void;
}

export const createInspectorSlice: StateCreator<CanvasState, [], [], InspectorSlice> = (set) => ({
  rightTab: "node",
  nodeState: "default",

  setRightTab(rightTab) {
    set({ rightTab });
  },

  setNodeState(nodeState) {
    set({ nodeState });
  },
});
