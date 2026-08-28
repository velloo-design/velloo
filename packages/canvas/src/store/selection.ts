import type { Node, Screen } from "@velloo/schema";
import type { StateCreator } from "zustand";
import { pathFromString } from "../path.ts";
import type { CanvasState } from "./index.ts";
import type { Selection } from "./types.ts";

/** The selected + hovered node, shared by the canvas frames, Tree, and Inspector. */
export interface SelectionSlice {
  selection: Selection | null;
  hover: Selection | null;
  /**
   * "Make this node visible" request, set by search jumps alongside the
   * selection. Frames showing the screen respond by scrolling the node into
   * view inside their iframe; `nonce` distinguishes repeated jumps to the
   * same node. Cleared by the next plain selection change.
   */
  reveal: (Selection & { nonce: number }) | null;

  setSelection(s: Selection | null): void;
  setHover(h: Selection | null): void;
  /** setSelection + a reveal request — the search dialog's "jump to node". */
  revealSelection(s: Selection): void;
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
  reveal: null,

  setSelection(selection) {
    if (get().reveal) set({ reveal: null });
    // Dedupe by value (fresh object literals arrive per click) so re-selecting
    // the selected node doesn't re-render every subscriber — but still run the
    // screen-follow below, since the *current screen* may have moved on.
    const prev = get().selection;
    const same =
      prev === selection ||
      (prev !== null &&
        selection !== null &&
        prev.screenId === selection.screenId &&
        prev.path === selection.path);
    if (!same) set({ selection });
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

  revealSelection(sel) {
    get().setSelection(sel);
    set((s) => ({ reveal: { ...sel, nonce: (s.reveal?.nonce ?? 0) + 1 } }));
  },

  setHover(hover) {
    // Dedupe by value: hover reports arrive as fresh object literals on every
    // pointer event, and setting an identical value re-renders every
    // subscriber and re-messages every frame iframe.
    const prev = get().hover;
    if (prev === hover) return;
    if (prev && hover && prev.screenId === hover.screenId && prev.path === hover.path) return;
    set({ hover });
  },
});
