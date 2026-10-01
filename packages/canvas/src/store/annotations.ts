import type { StateCreator } from "zustand";
import { fetchAnnotations, fetchNotes, notes as notesApi } from "../api.ts";
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
   * Open the editor on a new note — free at board coordinates (at the size the
   * user dragged out, or the default), or attached to a node. The note is a
   * local draft until it has something to say: `saveDraftNote` writes it in
   * one go, so creating a note is one undo step and an abandoned one leaves
   * nothing behind, on disk or on the undo stack.
   */
  createNote(placement: NotePlacement): void;
  /** Write a draft note with its first body. */
  saveDraftNote(
    id: string,
    patch: { body: string; width?: number; height?: number },
  ): Promise<void>;
  /** Patch a draft locally — it isn't on disk yet. */
  updateDraftNote(id: string, patch: Partial<Pick<CanvasNoteEntry, "width" | "height">>): void;
  discardDraftNote(id: string): void;
  setMarkupVisible(b: boolean): void;
  setEditingMarkupId(id: string | null): void;
}

type NotePlacement =
  | { x: number; y: number; width?: number; height?: number }
  | {
      attachment: NoteAttachment;
      /** The node's path as the frame resolved it, so the draft can sit on it. */
      resolved?: number[];
    };

const DRAFT_PREFIX = "draft:";
const DEFAULT_NOTE_WIDTH = 240;

/** A note the user is writing that hasn't been saved yet. */
export function isDraftNote(id: string): boolean {
  return id.startsWith(DRAFT_PREFIX);
}

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
      const notes = await fetchNotes(boardId);
      // A draft is still being written — a refresh mustn't take it away.
      set((s) => ({ notes: [...notes, ...s.notes.filter((n) => isDraftNote(n.id))] }));
      clearVanishedEdit(get);
    } catch {
      /* ignore */
    }
  },

  createNote(placement) {
    if (!get().currentBoardId) return;
    // Leave note mode first, so the click that placed this note can't place another.
    get().setCursorMode("select");
    const id = `${DRAFT_PREFIX}${Math.random().toString(36).slice(2, 10)}`;
    const draft: CanvasNoteEntry =
      "attachment" in placement
        ? {
            id,
            width: DEFAULT_NOTE_WIDTH,
            body: "",
            attachment: placement.attachment,
            resolved: placement.resolved ?? null,
          }
        : {
            id,
            x: placement.x,
            y: placement.y,
            width: placement.width ?? DEFAULT_NOTE_WIDTH,
            ...(placement.height !== undefined && { height: placement.height }),
            body: "",
          };
    set((s) => ({ notes: [...s.notes, draft] }));
    get().setMarkupVisible(true);
    get().setEditingMarkupId(id);
  },

  async saveDraftNote(id, patch) {
    const boardId = get().currentBoardId;
    const draft = get().notes.find((n) => n.id === id);
    if (!boardId || !draft) return;
    const next = { ...draft, ...patch };
    try {
      const { note } = await notesApi.add({
        boardId,
        body: next.body,
        width: next.width,
        ...(next.height !== undefined && { height: next.height }),
        ...(next.attachment ? { attachment: next.attachment } : { x: next.x ?? 0, y: next.y ?? 0 }),
      });
      // Swap in place so the note doesn't blink out between the write and
      // the notes-changed refresh.
      set((s) => ({
        notes: s.notes.some((n) => n.id === note.id)
          ? s.notes.filter((n) => n.id !== id)
          : s.notes.map((n) => (n.id === id ? { ...note, resolved: draft.resolved } : n)),
      }));
    } catch (err) {
      toastError(err, "Could not add note");
    }
  },

  updateDraftNote(id, patch) {
    set((s) => ({ notes: s.notes.map((n) => (n.id === id ? { ...n, ...patch } : n)) }));
  },

  discardDraftNote(id) {
    set((s) => ({ notes: s.notes.filter((n) => n.id !== id) }));
    clearVanishedEdit(get);
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
