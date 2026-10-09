import type { StateCreator } from "zustand";
import { type DesignLanguageState, type DesignRules, designLanguage } from "../api.ts";
import type { CanvasState } from "./index.ts";

/**
 * The design-language stage. It is a view of an ordinary board — the specimen
 * — so opening it makes sure that board exists and moves to it: every theme
 * control then edits the theme the specimen renders with, and leaving the stage
 * leaves you standing on the result.
 */
export interface LanguageSlice {
  /** Rules and specimen as the server last reported them; null until first loaded. */
  designLanguage: DesignLanguageState | null;

  openLanguage(): Promise<void>;
  closeLanguage(): void;
  refreshLanguage(): Promise<void>;
  saveRules(next: DesignRules): Promise<void>;
}

/** Rule saves the server has not answered yet; its replies apply only once none are pending. */
let savesInFlight = 0;

export const createLanguageSlice: StateCreator<CanvasState, [], [], LanguageSlice> = (
  set,
  get,
) => ({
  designLanguage: null,

  async openLanguage() {
    set({
      view: "language",
      libraryItem: null,
      selection: null,
      hover: null,
      snippetFocus: null,
    });
    let state = await designLanguage.fetch();
    if (!state.specimen?.boardId) {
      const built = await designLanguage.buildSpecimen();
      await get().refreshDesignSummary();
      state = { ...state, specimen: { screenId: built.screenId, boardId: built.boardId } };
    }
    set({ designLanguage: state });
    const boardId = state.specimen?.boardId;
    if (boardId && get().currentBoardId !== boardId) await get().selectBoard(boardId);
  },

  closeLanguage() {
    if (get().view === "language") set({ view: "boards" });
  },

  async refreshLanguage() {
    const state = await designLanguage.fetch();
    // A save still in flight is newer than anything the server can report yet.
    if (savesInFlight === 0) set({ designLanguage: state });
  },

  async saveRules(next) {
    const before = get().designLanguage;
    // Shown at once, and built on by the next edit: two rules added in quick
    // succession would otherwise each be saved on top of the list before either.
    if (before) set({ designLanguage: { ...before, rules: { ...before.rules, ...next } } });
    savesInFlight++;
    try {
      const { rules } = await designLanguage.saveRules(next);
      if (savesInFlight === 1) {
        set({ designLanguage: { specimen: get().designLanguage?.specimen ?? null, rules } });
      }
    } catch (err) {
      if (savesInFlight === 1) set({ designLanguage: await designLanguage.fetch() });
      throw err;
    } finally {
      savesInFlight--;
    }
  },
});
