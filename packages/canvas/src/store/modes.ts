import type { FrameScheme } from "@velloo/schema";
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
const PANES_KEY = "velloo:panes";
const PANE_WIDTHS_KEY = "velloo:paneWidths";
const REMEMBER_PANELS_KEY = "velloo:rememberPanels";

/**
 * Side-pane width bounds, in px. The floor is where the inspector's label +
 * control rows stop fitting side by side; the ceiling keeps a pane from
 * crowding out the canvas on a laptop screen.
 */
export const PANE_WIDTH = { min: 240, max: 560, default: 320 } as const;

export function clampPaneWidth(px: number): number {
  return Math.min(PANE_WIDTH.max, Math.max(PANE_WIDTH.min, Math.round(px)));
}

/**
 * Read a stored `{ name: collapsed }` record — the sections inside the left
 * sidebar and the two side panes both persist this shape, under the same
 * remember-panels gate. Anything missing or malformed reads as expanded.
 */
function readCollapsed<K extends string>(key: string, names: readonly K[]): Record<K, boolean> {
  const out = Object.fromEntries(names.map((n) => [n, false])) as Record<K, boolean>;
  if (typeof localStorage === "undefined" || !readFlag(REMEMBER_PANELS_KEY, true)) return out;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return out;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    for (const n of names) out[n] = parsed[n] === true;
    return out;
  } catch {
    return out;
  }
}

function persistCollapsed(key: string, value: Record<string, boolean>) {
  if (typeof localStorage !== "undefined" && readFlag(REMEMBER_PANELS_KEY, true)) {
    localStorage.setItem(key, JSON.stringify(value));
  }
}

/** Dragged pane widths. Clamped on read too — the bounds can move between releases. */
function readPaneWidths(): { left: number; right: number } {
  const fallback = { left: PANE_WIDTH.default, right: PANE_WIDTH.default };
  if (typeof localStorage === "undefined" || !readFlag(REMEMBER_PANELS_KEY, true)) return fallback;
  try {
    const raw = localStorage.getItem(PANE_WIDTHS_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as { left?: unknown; right?: unknown };
    return {
      left: typeof parsed.left === "number" ? clampPaneWidth(parsed.left) : fallback.left,
      right: typeof parsed.right === "number" ? clampPaneWidth(parsed.right) : fallback.right,
    };
  } catch {
    return fallback;
  }
}

function persistPaneWidths(left: number, right: number) {
  if (typeof localStorage !== "undefined" && readFlag(REMEMBER_PANELS_KEY, true)) {
    localStorage.setItem(PANE_WIDTHS_KEY, JSON.stringify({ left, right }));
  }
}

/**
 * The canvas preferences as stored, read once when the store is created.
 * Exported because it *is* the boot path — the store's initial state is
 * nothing but this — and a test can call it against a stubbed localStorage
 * without depending on when the store module happened to evaluate.
 */
export function readCanvasPrefs() {
  const panels = readCollapsed(LEFT_PANELS_KEY, ["boards", "tree"]);
  const panes = readCollapsed(PANES_KEY, ["left", "right"]);
  const widths = readPaneWidths();
  return {
    appTheme: readAppTheme(),
    designMode: readDesignMode(),
    rememberDesignMode: readFlag(REMEMBER_DESIGN_MODE_KEY, true),
    rememberPanels: readFlag(REMEMBER_PANELS_KEY, true),
    boardsCollapsed: panels.boards,
    treeCollapsed: panels.tree,
    leftPaneCollapsed: panes.left,
    rightPaneCollapsed: panes.right,
    leftPaneWidth: widths.left,
    rightPaneWidth: widths.right,
  };
}

/** Every localStorage key the canvas owns — the list "reset preferences" clears. */
const CANVAS_PREF_KEYS = [
  APP_THEME_KEY,
  DESIGN_MODE_KEY,
  REMEMBER_DESIGN_MODE_KEY,
  LEFT_PANELS_KEY,
  PANES_KEY,
  PANE_WIDTHS_KEY,
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
  /** Left sidebar collapsed to its rail, handing the width to the canvas. */
  leftPaneCollapsed: boolean;
  /** Right inspector/theme pane collapsed to its rail. */
  rightPaneCollapsed: boolean;
  /** Dragged width of the left sidebar, in px. */
  leftPaneWidth: number;
  /** Dragged width of the right pane, in px. */
  rightPaneWidth: number;
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
  setLeftPaneCollapsed(collapsed: boolean): void;
  setRightPaneCollapsed(collapsed: boolean): void;
  /** Commit a dragged width; clamped to `PANE_WIDTH`. */
  setLeftPaneWidth(px: number): void;
  setRightPaneWidth(px: number): void;
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
  /** Originating frame pin; absent means keep following the canvas default. */
  scheme?: FrameScheme;
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
      persistCollapsed(LEFT_PANELS_KEY, { boards: s.boardsCollapsed, tree: s.treeCollapsed });
      persistCollapsed(PANES_KEY, { left: s.leftPaneCollapsed, right: s.rightPaneCollapsed });
      persistPaneWidths(s.leftPaneWidth, s.rightPaneWidth);
    } else {
      localStorage.removeItem(LEFT_PANELS_KEY);
      localStorage.removeItem(PANES_KEY);
      localStorage.removeItem(PANE_WIDTHS_KEY);
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
      leftPaneCollapsed: false,
      rightPaneCollapsed: false,
      leftPaneWidth: PANE_WIDTH.default,
      rightPaneWidth: PANE_WIDTH.default,
    });
  },

  toggleBoardsCollapsed() {
    set((s) => {
      const boardsCollapsed = !s.boardsCollapsed;
      persistCollapsed(LEFT_PANELS_KEY, { boards: boardsCollapsed, tree: s.treeCollapsed });
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
      persistCollapsed(LEFT_PANELS_KEY, { boards: s.boardsCollapsed, tree: treeCollapsed });
      return { treeCollapsed };
    });
  },

  setLeftPaneCollapsed(leftPaneCollapsed) {
    set((s) => {
      persistCollapsed(PANES_KEY, { left: leftPaneCollapsed, right: s.rightPaneCollapsed });
      return { leftPaneCollapsed };
    });
  },

  setRightPaneCollapsed(rightPaneCollapsed) {
    set((s) => {
      persistCollapsed(PANES_KEY, { left: s.leftPaneCollapsed, right: rightPaneCollapsed });
      return { rightPaneCollapsed };
    });
  },

  setLeftPaneWidth(px) {
    set((s) => {
      const leftPaneWidth = clampPaneWidth(px);
      persistPaneWidths(leftPaneWidth, s.rightPaneWidth);
      return { leftPaneWidth };
    });
  },

  setRightPaneWidth(px) {
    set((s) => {
      const rightPaneWidth = clampPaneWidth(px);
      persistPaneWidths(s.leftPaneWidth, rightPaneWidth);
      return { rightPaneWidth };
    });
  },
});
