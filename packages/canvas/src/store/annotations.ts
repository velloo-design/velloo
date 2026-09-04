import type { StateCreator } from "zustand";
import { notes as notesApi } from "../api.ts";
import { toastError } from "../toast.ts";
import type { CanvasState } from "./index.ts";
import type { AnnotationEntry, CanvasNoteEntry, NoteAttachment } from "./types.ts";

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

/** Legacy repo annotations plus board notes. New feedback uses comments. */
export interface AnnotationsSlice {
  annotations: AnnotationEntry[];
  notes: CanvasNoteEntry[];
  /**
   * One switch for everything drawn *over* the design — notes, annotations
   * and comment pins. The top bar's eye drives it; comment flows force it
   * back on, since acting on a thread has to reveal its pin.
   */
  markupVisible: boolean;
  editingMarkupId: string | null;

  refreshAnnotations(): Promise<void>;
  refreshNotes(): Promise<void>;
  /**
   * Drop a note and open its editor. Either free at board coordinates or
   * attached to a node, which the server auto-places beside the frame.
   */
  createNote(placement: NotePlacement): Promise<void>;
  setMarkupVisible(b: boolean): void;
  setEditingMarkupId(id: string | null): void;
}

export type NotePlacement = { x: number; y: number } | { attachment: NoteAttachment };

export const createAnnotationsSlice: StateCreator<CanvasState, [], [], AnnotationsSlice> = (
  set,
  get,
) => ({
  annotations: [],
  notes: [],
  markupVisible: true,
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

  async createNote(placement) {
    const boardId = get().currentBoardId;
    if (!boardId) return;
    // Leave note mode first: the round-trip below is long enough for a second
    // click to land and spawn a note nobody asked for.
    get().setCursorMode("select");
    try {
      const { note } = await notesApi.add({ boardId, body: "", ...placement });
      // Insert optimistically so the editor opens now — the ws notes-changed
      // refresh confirms it. Setting the editing id before the note exists in
      // the store would race the vanished-edit sweep.
      set((s) => ({ notes: s.notes.some((n) => n.id === note.id) ? s.notes : [...s.notes, note] }));
      get().setMarkupVisible(true);
      get().setEditingMarkupId(note.id);
    } catch (err) {
      toastError(err, "Could not add note");
    }
  },

  setMarkupVisible(markupVisible) {
    // Hiding the markup layer unmounts an in-progress editor without a blur —
    // end the session so the camera restores and the edit isn't stranded.
    if (!markupVisible) get().setEditingMarkupId(null);
    set({ markupVisible });
  },

  setEditingMarkupId(editingMarkupId) {
    const prev = get().editingMarkupId;
    if (prev === editingMarkupId) return;
    set({ editingMarkupId });
    if (editingMarkupId && !prev) get().zoomForMarkupEdit();
    else if (!editingMarkupId && prev) get().restoreViewAfterMarkupEdit();
  },
});
