import type { StateCreator } from "zustand";
import type { CanvasState } from "./index.ts";
import type { AppTheme, DesignMode } from "./types.ts";

const APP_THEME_KEY = "velloo:appTheme";

function readAppTheme(): AppTheme {
  if (typeof localStorage === "undefined") return "system";
  const raw = localStorage.getItem(APP_THEME_KEY);
  return raw === "light" || raw === "dark" || raw === "system" ? raw : "system";
}

const LEFT_PANELS_KEY = "velloo:leftPanels";

/** Collapsed state of the boards-mode left panels, persisted like the app theme. */
function readLeftPanels(): { boards: boolean; tree: boolean } {
  if (typeof localStorage === "undefined") return { boards: false, tree: false };
  try {
    const raw = localStorage.getItem(LEFT_PANELS_KEY);
    if (!raw) return { boards: false, tree: false };
    const parsed = JSON.parse(raw) as { boards?: unknown; tree?: unknown };
    return { boards: parsed.boards === true, tree: parsed.tree === true };
  } catch {
    return { boards: false, tree: false };
  }
}

function persistLeftPanels(boards: boolean, tree: boolean) {
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(LEFT_PANELS_KEY, JSON.stringify({ boards, tree }));
  }
}

/** Persisted UI modes: app chrome theme, design light/dark, sidebar panel collapse. */
export interface ModesSlice {
  appTheme: AppTheme;
  designMode: DesignMode;
  /** Collapsed state of the boards list in the boards-mode left sidebar. */
  boardsCollapsed: boolean;
  /** Collapsed state of the screen tree in the boards-mode left sidebar. */
  treeCollapsed: boolean;
  /** Ctrl/Cmd+K search dialog visibility (session-only, not persisted). */
  searchOpen: boolean;

  setAppTheme(t: AppTheme): void;
  setDesignMode(m: DesignMode): void;
  toggleBoardsCollapsed(): void;
  toggleTreeCollapsed(): void;
  setSearchOpen(open: boolean): void;
}

export const createModesSlice: StateCreator<CanvasState, [], [], ModesSlice> = (set) => ({
  appTheme: readAppTheme(),
  designMode: "light",
  boardsCollapsed: readLeftPanels().boards,
  treeCollapsed: readLeftPanels().tree,
  searchOpen: false,

  setAppTheme(appTheme) {
    set({ appTheme });
    if (typeof localStorage !== "undefined") localStorage.setItem(APP_THEME_KEY, appTheme);
  },

  setDesignMode(designMode) {
    set({ designMode });
  },

  toggleBoardsCollapsed() {
    set((s) => {
      const boardsCollapsed = !s.boardsCollapsed;
      persistLeftPanels(boardsCollapsed, s.treeCollapsed);
      return { boardsCollapsed };
    });
  },

  setSearchOpen(searchOpen) {
    set({ searchOpen });
  },

  toggleTreeCollapsed() {
    set((s) => {
      const treeCollapsed = !s.treeCollapsed;
      persistLeftPanels(s.boardsCollapsed, treeCollapsed);
      return { treeCollapsed };
    });
  },
});
