import type { StateCreator } from "zustand";
import type { CanvasState } from "./index.ts";
import type { AnnotationEntry, CanvasNoteEntry } from "./types.ts";

/**
 * End the edit session when the edited markup no longer exists (agent removed
 * it mid-edit) — otherwise the markup-edit camera never restores. Unmounting
 * the card can't do this: removing a focused element fires no blur.
 */
function clearVanishedEdit(get: () => CanvasState): void {
  const id = get().editingMarkupId;
  if (!id) return;
  const live = get().annotations.some((a) => a.id === id) || get().notes.some((n) => n.id === id);
  if (!live) get().setEditingMarkupId(null);
}

/** Legacy repo annotations plus board sticky notes. New feedback uses comments. */
export interface AnnotationsSlice {
  annotations: AnnotationEntry[];
  notes: CanvasNoteEntry[];
  annotationsVisible: boolean;
  editingMarkupId: string | null;

  refreshAnnotations(): Promise<void>;
  refreshNotes(): Promise<void>;
  setAnnotationsVisible(b: boolean): void;
  setEditingMarkupId(id: string | null): void;
}

export const createAnnotationsSlice: StateCreator<CanvasState, [], [], AnnotationsSlice> = (
  set,
  get,
) => ({
  annotations: [],
  notes: [],
  annotationsVisible: true,
  editingMarkupId: null,

  async refreshAnnotations() {
    const boardId = get().currentBoardId;
    const board = boardId ? get().boards[boardId] : null;
    // Board-scoped: load every screen that has a frame on the current board
    // so cards stay visible when focus moves between screens (agent work).
    const screenIds = board
      ? [...new Set(board.frames.map((f) => f.screen))]
      : get().currentScreenId
        ? [get().currentScreenId as string]
        : [];
    if (screenIds.length === 0) {
      set({ annotations: [] });
      return;
    }
    try {
      const { fetchAnnotations } = await import("../api.ts");
      const lists = await Promise.all(screenIds.map((id) => fetchAnnotations(id)));
      set({ annotations: lists.flat() });
      clearVanishedEdit(get);
    } catch {
      /* ignore */
    }
  },

  async refreshNotes() {
    const boardId = get().currentBoardId;
    if (!boardId) return;
    try {
      const { fetchNotes } = await import("../api.ts");
      const notes = await fetchNotes(boardId);
      set({ notes });
      clearVanishedEdit(get);
    } catch {
      /* ignore */
    }
  },

  setAnnotationsVisible(annotationsVisible) {
    // Hiding the markup layer unmounts an in-progress editor without a blur —
    // end the session so the camera restores and the edit isn't stranded.
    if (!annotationsVisible) get().setEditingMarkupId(null);
    set({ annotationsVisible });
  },

  setEditingMarkupId(editingMarkupId) {
    const prev = get().editingMarkupId;
    if (prev === editingMarkupId) return;
    set({ editingMarkupId });
    if (editingMarkupId && !prev) get().zoomForMarkupEdit();
    else if (!editingMarkupId && prev) get().restoreViewAfterMarkupEdit();
  },
});
