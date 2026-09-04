import type { Node, Screen } from "@velloo/schema";
import type { StateCreator } from "zustand";
import { fetchSnippet } from "../api/discovery.ts";
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
  /** Whether the latest selection is meant to inspect a node or only locate it. */
  selectionIntent: "inspect" | "preserve-tab";
  /**
   * The snippet the canvas is scoped into, entered by double-clicking an
   * instance. Every instance of it stays live while the rest of the screen
   * dims, and edits inside land on the definition — so all instances move
   * together, which is the whole reason to edit in place rather than in the
   * snippet editor.
   */
  snippetFocus: string | null;

  setSelection(s: Selection | null): void;
  setHover(h: Selection | null): void;
  setSnippetFocus(snippetId: string | null): void;
  /** setSelection + a reveal request — the search dialog's "jump to node". */
  revealSelection(s: Selection, options?: { preserveTab?: boolean }): void;
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
  selectionIntent: "inspect",
  snippetFocus: null,

  setSnippetFocus(snippetFocus) {
    if (get().snippetFocus === snippetFocus) return;
    // Leaving focus drops any selection that pointed into the definition —
    // a `snippet:<id>` selection outside the mode addresses nothing on screen.
    const inBody = get().selection?.screenId.startsWith("snippet:") === true;
    set({ snippetFocus, ...(inBody ? { selection: null, hover: null } : {}) });
    if (snippetFocus === null) return;
    // Whatever was selected addressed the screen, not the definition — keeping
    // it would leave the HUD editing the enclosing instance while the canvas
    // says we're inside the snippet.
    set({ selection: null, hover: null });
    // The definition becomes a synthetic screen, which is what lets selection,
    // the tree, the HUD and the mutation layer target it with no special case:
    // `snippet:<id>` is a screen id the server already virtualizes.
    void fetchSnippet(snippetFocus)
      .then((snippet) => {
        if (get().snippetFocus !== snippetFocus) return;
        get().setSyntheticScreen(`snippet:${snippetFocus}`, {
          id: `snippet:${snippetFocus}`,
          name: snippet.name,
          tree: snippet.tree,
          ...(snippet.library ? { library: snippet.library } : {}),
        });
        // Land on the definition root so the bar has something to edit the
        // moment the mode opens.
        get().setSelection({ screenId: `snippet:${snippetFocus}`, path: "" });
      })
      .catch(() => set({ snippetFocus: null }));
  },

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
    if (!same) set({ selection, selectionIntent: "inspect" });
    else if (selection && get().selectionIntent !== "inspect") set({ selectionIntent: "inspect" });
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

  revealSelection(sel, options = {}) {
    get().setSelection(sel);
    set((s) => ({
      reveal: { ...sel, nonce: (s.reveal?.nonce ?? 0) + 1 },
      selectionIntent: options.preserveTab ? "preserve-tab" : "inspect",
    }));
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
