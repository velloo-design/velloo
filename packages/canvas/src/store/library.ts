import type { Screen } from "@velloo/schema";
import type { StateCreator } from "zustand";
import type { CanvasState } from "./index.ts";
import type { LibraryItemRef, ViewMode } from "./types.ts";

/** View switching: boards ↔ component library ↔ the focused snippet editor. */
export interface LibrarySlice {
  view: ViewMode;
  libraryItem: LibraryItemRef | null;
  /** The item open when the Library was last left, reopened by the Library tab. */
  lastLibraryItem: LibraryItemRef | null;
  /**
   * Snippet currently open in the focused snippet view. When non-null the main
   * area renders the snippet as a single iframe at the chosen viewport, with
   * the right panel scoped to snippet metadata + params. `view` is set to
   * `"snippet"` while this is non-null and snaps back to the prior view on close.
   */
  editingSnippetId: string | null;
  /** View the canvas was on before entering snippet mode; restored on close. */
  preSnippetView: ViewMode | null;

  setView(view: ViewMode): void;
  openLibrary(item?: LibraryItemRef | null): void;
  closeLibrary(): void;
  openSnippetEditor(snippetId: string): void;
  closeSnippetEditor(): void;
  /**
   * Install a synthetic screen — used by the snippet editor view to
   * surface the snippet body under `screens["snippet:<id>"]` so the
   * Tree, Inspector, and selection model can target it without
   * special-casing.
   */
  setSyntheticScreen(screenId: string, screen: Screen): void;
}

export const createLibrarySlice: StateCreator<CanvasState, [], [], LibrarySlice> = (set, get) => ({
  view: "boards",
  libraryItem: null,
  lastLibraryItem: null,
  editingSnippetId: null,
  preSnippetView: null,

  setView(view) {
    const { libraryItem, lastLibraryItem } = get();
    if (view === "boards") set({ view, libraryItem: null, lastLibraryItem: libraryItem });
    else if (view === "library") set({ view, libraryItem: libraryItem ?? lastLibraryItem });
    else set({ view });
    if (view === "library" || view === "snippet") void get().loadComponents();
  },

  openLibrary(item) {
    set({ view: "library", libraryItem: item ?? null, lastLibraryItem: null });
    void get().loadComponents();
  },

  closeLibrary() {
    set((s) => ({ view: "boards", libraryItem: null, lastLibraryItem: s.libraryItem }));
  },

  openSnippetEditor(snippetId) {
    const current = get().view;
    set({
      view: "snippet",
      editingSnippetId: snippetId,
      preSnippetView: current === "snippet" ? get().preSnippetView : current,
      // Clear screen-anchored selection — the snippet view has its own
      // (screen-shaped) selection space and stale screen selections
      // would render highlights for the wrong context.
      selection: null,
      hover: null,
    });
    void get().loadComponents();
  },

  closeSnippetEditor() {
    const fallback = get().preSnippetView ?? "boards";
    set((s) => {
      // Sweep synthetic `snippet:<id>` screens — they're scoped to the
      // editor view and shouldn't linger in store state after exit.
      const cleaned: Record<string, Screen> = {};
      for (const [id, screen] of Object.entries(s.screens)) {
        if (!id.startsWith("snippet:")) cleaned[id] = screen;
      }
      return {
        view: fallback,
        editingSnippetId: null,
        preSnippetView: null,
        selection: null,
        hover: null,
        screens: cleaned,
      };
    });
  },

  setSyntheticScreen(screenId, screen) {
    set((s) => {
      // Bail out early when the synthetic screen is byte-identical to
      // the one already installed. Critical for breaking the obvious
      // re-render loop where a useEffect listens for `screenVersion`
      // changes AND calls `setSyntheticScreen` from its body — the
      // first set would bump the version, the effect would re-fire,
      // fetch the same snippet, call this again, bump the version
      // again, ad infinitum. Cheap to compare because synthetic
      // screens are plain JSON shaped like the on-disk Screen.
      const existing = s.screens[screenId];
      if (existing && JSON.stringify(existing) === JSON.stringify(screen)) return s;
      return {
        screens: { ...s.screens, [screenId]: screen },
        screenVersion: s.screenVersion + 1,
        screenVersions: { ...s.screenVersions, [screenId]: (s.screenVersions[screenId] ?? 0) + 1 },
      };
    });
  },
});
