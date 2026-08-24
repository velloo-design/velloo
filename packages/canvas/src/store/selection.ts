import type { Node, Screen } from "@velloo/schema";
import type { StateCreator } from "zustand";
import { pathFromString } from "../path.ts";
import type { CanvasState } from "./index.ts";
import type { Selection } from "./types.ts";

/** The selected + hovered node, shared by the canvas frames, Tree, and Inspector. */
export interface SelectionSlice {
  selection: Selection | null;
  hover: Selection | null;

  setSelection(s: Selection | null): void;
  setHover(h: Selection | null): void;
}

export function selectedNode(screens: Record<string, Screen>, sel: Selection | null): Node | null {
  if (!sel) return null;
  const screen = screens[sel.screenId];
  if (!screen) return null;
  const path = pathFromString(sel.path);
  let node: Node | undefined = screen.tree;
  for (const idx of path) {
    if (!node || !("$ref" in node)) return null;
    const children: Node[] | undefined = node.children;
    if (!children || idx < 0 || idx >= children.length) return null;
    node = children[idx];
  }
  return node ?? null;
}

export const createSelectionSlice: StateCreator<CanvasState, [], [], SelectionSlice> = (
  set,
  get,
) => ({
  selection: null,
  hover: null,

  setSelection(selection) {
    set({ selection });
    // If the selected node lives on a screen other than the currently
    // open one, follow it — otherwise the sidebar Tree shows a tree
    // unrelated to what's selected in the canvas. Annotations follow
    // along too so the right panel stays coherent. Snippet-virtual
    // screen ids (`snippet:<id>`) don't live on disk and are owned by
    // the snippet editor view — skip auto-switching for them.
    if (
      selection &&
      selection.screenId !== get().currentScreenId &&
      !selection.screenId.startsWith("snippet:")
    ) {
      void get().selectScreen(selection.screenId);
    }
  },

  setHover(hover) {
    set({ hover });
  },
});
