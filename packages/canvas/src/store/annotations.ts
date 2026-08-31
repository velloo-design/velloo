import type { StateCreator } from "zustand";
import { toastError } from "../toast.ts";
import type { CanvasState } from "./index.ts";
import type { AnnotationEntry, CanvasNoteEntry, Selection } from "./types.ts";

/** Prevents subscribe + enterAnnotateMode from double-creating on one pick. */
let creatingAnnotation = false;

function locatorForSelection(sel: Selection): number[] {
  return sel.path === "" ? [] : sel.path.split(".").map(Number);
}

function annotationMatchesSelection(a: AnnotationEntry, sel: Selection): boolean {
  if (a.screenId !== sel.screenId) return false;
  if (a.resolved && a.resolved.join(".") === sel.path) return true;
  const loc = a.target.locator;
  if (Array.isArray(loc)) return loc.join(".") === sel.path;
  return loc === sel.path;
}

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
  /**
   * Annotate tool entry: with a selection, create (or open) an annotation on
   * that node immediately; otherwise arm pick-a-node mode.
   */
  enterAnnotateMode(): void;
  /** Create an annotation on `sel` (or focus the existing one) and enter edit. */
  createAnnotationOnSelection(sel: Selection): Promise<void>;
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

  enterAnnotateMode() {
    const sel = get().selection;
    if (sel) {
      void get().createAnnotationOnSelection(sel);
      return;
    }
    set({ cursorMode: "annotate", hover: null });
  },

  async createAnnotationOnSelection(sel) {
    if (creatingAnnotation) return;
    creatingAnnotation = true;
    try {
      set({ cursorMode: "select", hover: null });

      const existing = get().annotations.find((a) => annotationMatchesSelection(a, sel));
      if (existing) {
        set({ editingMarkupId: existing.id });
        return;
      }

      // Follow the node's screen before add so selectScreen can't clear
      // editingMarkupId after we set it.
      if (
        sel.screenId !== get().currentScreenId &&
        !sel.screenId.startsWith("snippet:")
      ) {
        await get().selectScreen(sel.screenId);
      }

      const locator = locatorForSelection(sel);
      const { annotations: annotationsApi } = await import("../api.ts");
      try {
        const r = await annotationsApi.add({
          screenId: sel.screenId,
          target: { locator },
          body: "",
        });
        const entry: AnnotationEntry = {
          ...r.annotation,
          screenId: sel.screenId,
          resolved: locator,
        };
        set((s) => ({
          annotations: s.annotations.some((a) => a.id === entry.id)
            ? s.annotations
            : [...s.annotations, entry],
          editingMarkupId: entry.id,
        }));
      } catch (err) {
        const payload = (err as Error & { payload?: { kind?: string; existingId?: string } })
          .payload;
        if (payload?.kind === "AnnotationConflict" && payload.existingId) {
          set({ editingMarkupId: payload.existingId });
          return;
        }
        toastError(err, "Could not add annotation");
      }
    } finally {
      creatingAnnotation = false;
    }
  },
});
