import type { StateCreator } from "zustand";
import type { CanvasState } from "./index.ts";
import type { AnnotationEntry, CanvasNoteEntry } from "./types.ts";

/** Node-anchored annotations + board sticky notes (the markup layer). */
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
    const id = get().currentScreenId;
    if (!id) return;
    try {
      const { fetchAnnotations } = await import("../api.ts");
      const annotations = await fetchAnnotations(id);
      set({ annotations });
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
    } catch {
      /* ignore */
    }
  },

  setAnnotationsVisible(annotationsVisible) {
    set({ annotationsVisible });
  },

  setEditingMarkupId(editingMarkupId) {
    set({ editingMarkupId });
  },
});
