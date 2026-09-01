import type { StateCreator } from "zustand";
import type { CanvasState } from "./index.ts";
import type { AppTheme, DesignMode } from "./types.ts";

const APP_THEME_KEY = "velloo:appTheme";

function readAppTheme(): AppTheme {
  if (typeof localStorage === "undefined") return "system";
  const raw = localStorage.getItem(APP_THEME_KEY);
  return raw === "light" || raw === "dark" || raw === "system" ? raw : "system";
}

/**
 * Design light/dark. Persisted only while `rememberDesignMode` is on — a
 * canvas that reopens in dark when you left it dark, unless the user has
 * asked for a predictable light start.
 */
const DESIGN_MODE_KEY = "velloo:designMode";
const REMEMBER_DESIGN_MODE_KEY = "velloo:rememberDesignMode";

function readFlag(key: string, fallback: boolean): boolean {
  if (typeof localStorage === "undefined") return fallback;
  const raw = localStorage.getItem(key);
  return raw === null ? fallback : raw === "true";
}

function readDesignMode(): DesignMode {
  if (typeof localStorage === "undefined") return "light";
  if (!readFlag(REMEMBER_DESIGN_MODE_KEY, true)) return "light";
  return localStorage.getItem(DESIGN_MODE_KEY) === "dark" ? "dark" : "light";
}

const LEFT_PANELS_KEY = "velloo:leftPanels";
const REMEMBER_PANELS_KEY = "velloo:rememberPanels";

/** Collapsed state of the boards-mode left panels, persisted like the app theme. */
function readLeftPanels(): { boards: boolean; tree: boolean } {
  if (typeof localStorage === "undefined") return { boards: false, tree: false };
  if (!readFlag(REMEMBER_PANELS_KEY, true)) return { boards: false, tree: false };
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
  if (typeof localStorage !== "undefined" && readFlag(REMEMBER_PANELS_KEY, true)) {
    localStorage.setItem(LEFT_PANELS_KEY, JSON.stringify({ boards, tree }));
  }
}

/**
 * The canvas preferences as stored, read once when the store is created.
 * Exported because it *is* the boot path — the store's initial state is
 * nothing but this — and a test can call it against a stubbed localStorage
 * without depending on when the store module happened to evaluate.
 */
export function readCanvasPrefs() {
  const panels = readLeftPanels();
  return {
    appTheme: readAppTheme(),
    designMode: readDesignMode(),
    rememberDesignMode: readFlag(REMEMBER_DESIGN_MODE_KEY, true),
    rememberPanels: readFlag(REMEMBER_PANELS_KEY, true),
    boardsCollapsed: panels.boards,
    treeCollapsed: panels.tree,
  };
}

/** Every localStorage key the canvas owns — the list "reset preferences" clears. */
const CANVAS_PREF_KEYS = [
  APP_THEME_KEY,
  DESIGN_MODE_KEY,
  REMEMBER_DESIGN_MODE_KEY,
  LEFT_PANELS_KEY,
  REMEMBER_PANELS_KEY,
];

/** Which scope the settings dialog is showing. */
export type SettingsScope = "folder" | "board" | "canvas";

/** Persisted UI modes: app chrome theme, design light/dark, sidebar panel collapse. */
export interface ModesSlice {
  appTheme: AppTheme;
  designMode: DesignMode;
  /** Whether `designMode` survives a reload. */
  rememberDesignMode: boolean;
  /** Whether the sidebar panels' collapsed state survives a reload. */
  rememberPanels: boolean;
  /** Settings dialog: null = closed, otherwise the open scope. */
  settingsScope: SettingsScope | null;
  /** Collapsed state of the boards list in the boards-mode left sidebar. */
  boardsCollapsed: boolean;
  /** Collapsed state of the screen tree in the boards-mode left sidebar. */
  treeCollapsed: boolean;
  /** Ctrl/Cmd+K search dialog visibility (session-only, not persisted). */
  searchOpen: boolean;
  /** Export dialog target (session-only); null = closed. */
  exportTarget: ExportTarget | null;
  /** Full-screen preview target (session-only); null = closed. */
  previewTarget: PreviewTarget | null;

  setAppTheme(t: AppTheme): void;
  setDesignMode(m: DesignMode): void;
  setRememberDesignMode(on: boolean): void;
  setRememberPanels(on: boolean): void;
  setSettingsScope(scope: SettingsScope | null): void;
  /** Clear every canvas preference and return to defaults, without a reload. */
  resetCanvasPrefs(): void;
  toggleBoardsCollapsed(): void;
  toggleTreeCollapsed(): void;
  setSearchOpen(open: boolean): void;
  setExportTarget(target: ExportTarget | null): void;
  setPreviewTarget(target: PreviewTarget | null): void;
}

/** What the export dialog is pointed at — a frame or a whole board. */
export interface ExportTarget {
  kind: "frame" | "board";
  id: string;
  /** Display name for the dialog title + default filename. */
  name: string;
}

/** What the full-screen preview modal shows. Read-only — never written back. */
export interface PreviewTarget {
  screenId: string;
  /** Display name for the modal title. */
  name: string;
  /** Board theme pin, so the preview matches the frame's board. */
  boardTheme?: string;
  /** Starting preview width — the originating frame's width. */
  w: number;
}

export const createModesSlice: StateCreator<CanvasState, [], [], ModesSlice> = (set, get) => ({
  ...readCanvasPrefs(),
  settingsScope: null,
  searchOpen: false,
  exportTarget: null,
  previewTarget: null,

  setAppTheme(appTheme) {
    set({ appTheme });
    if (typeof localStorage !== "undefined") localStorage.setItem(APP_THEME_KEY, appTheme);
  },

  setDesignMode(designMode) {
    set({ designMode });
    if (typeof localStorage !== "undefined" && readFlag(REMEMBER_DESIGN_MODE_KEY, true)) {
      localStorage.setItem(DESIGN_MODE_KEY, designMode);
    }
  },

  setRememberDesignMode(rememberDesignMode) {
    set({ rememberDesignMode });
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(REMEMBER_DESIGN_MODE_KEY, String(rememberDesignMode));
    // Turning it on adopts the mode you are looking at right now, so the
    // switch takes effect without a second toggle of the design preset.
    if (rememberDesignMode) localStorage.setItem(DESIGN_MODE_KEY, get().designMode);
    else localStorage.removeItem(DESIGN_MODE_KEY);
  },

  setRememberPanels(rememberPanels) {
    set({ rememberPanels });
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(REMEMBER_PANELS_KEY, String(rememberPanels));
    if (rememberPanels) {
      const s = get();
      localStorage.setItem(
        LEFT_PANELS_KEY,
        JSON.stringify({ boards: s.boardsCollapsed, tree: s.treeCollapsed }),
      );
    } else {
      localStorage.removeItem(LEFT_PANELS_KEY);
    }
  },

  setSettingsScope(settingsScope) {
    set({ settingsScope });
  },

  resetCanvasPrefs() {
    if (typeof localStorage !== "undefined") {
      for (const key of CANVAS_PREF_KEYS) localStorage.removeItem(key);
    }
    set({
      appTheme: "system",
      designMode: "light",
      rememberDesignMode: true,
      rememberPanels: true,
      boardsCollapsed: false,
      treeCollapsed: false,
    });
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

  setExportTarget(exportTarget) {
    set({ exportTarget });
  },

  setPreviewTarget(previewTarget) {
    set({ previewTarget });
  },

  toggleTreeCollapsed() {
    set((s) => {
      const treeCollapsed = !s.treeCollapsed;
      persistLeftPanels(s.boardsCollapsed, treeCollapsed);
      return { treeCollapsed };
    });
  },
});
