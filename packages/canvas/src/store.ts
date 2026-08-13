import type { Board, Node, Screen, Theme } from "@velloo/schema";
import type { Manifest } from "@velloo/shadcn-snapshot";
import { create } from "zustand";
import {
  type DesignSummary,
  fetchComponents,
  fetchDesign,
  fetchHistory,
  fetchPresets,
  fetchScreen,
  fetchTheme,
  type HistoryDepths,
} from "./api.ts";
import { pathFromString } from "./path.ts";

export type RightTab = "node" | "theme";
export type CursorMode = "select" | "hand" | "note" | "annotate";
export type NodeState = "default" | "hover" | "focus" | "active" | "disabled";
export type AppTheme = "light" | "dark" | "system";
export type DesignMode = "light" | "dark";

export interface AnnotationEntry {
  id: string;
  target: { locator: number[] | string };
  position: { x: number; y: number } | "auto";
  body: string;
  collapsed?: boolean;
  resolved: number[] | null;
}

export interface CanvasNoteEntry {
  id: string;
  x: number;
  y: number;
  width: number;
  body: string;
}

const APP_THEME_KEY = "velloo:appTheme";

function readAppTheme(): AppTheme {
  if (typeof localStorage === "undefined") return "system";
  const raw = localStorage.getItem(APP_THEME_KEY);
  return raw === "light" || raw === "dark" || raw === "system" ? raw : "system";
}

export interface Selection {
  screenId: string;
  path: string;
}

export interface CanvasState {
  design: DesignSummary | null;
  screens: Record<string, Screen>;
  board: Board | null;
  currentScreenId: string | null;
  screenVersion: number;
  components: Manifest | null;
  theme: Theme | null;
  themeVersion: number;
  presets: string[];
  selection: Selection | null;
  hover: Selection | null;
  wsConnected: boolean;
  rightTab: RightTab;
  canvasZoom: number;
  cursorMode: CursorMode;
  pan: { x: number; y: number };
  nodeState: NodeState;
  appTheme: AppTheme;
  history: HistoryDepths;
  designMode: DesignMode;
  annotations: AnnotationEntry[];
  notes: CanvasNoteEntry[];
  nodeRects: Record<string, Record<string, { x: number; y: number; w: number; h: number }>>;
  annotationsVisible: boolean;
  editingMarkupId: string | null;
  focusedAnnotationId: string | null;

  loadDesign(): Promise<void>;
  refreshHistory(): Promise<void>;
  refreshDesignSummary(): Promise<void>;
  loadComponents(): Promise<void>;
  loadTheme(): Promise<void>;
  refreshTheme(): Promise<void>;
  selectScreen(screenId: string): Promise<void>;
  loadScreen(screenId: string): Promise<Screen | null>;
  refreshCurrentScreen(): Promise<void>;
  refreshScreen(screenId: string): Promise<void>;
  refreshBoard(): Promise<void>;
  setSelection(s: Selection | null): void;
  setHover(h: Selection | null): void;
  setWsConnected(b: boolean): void;
  setRightTab(t: RightTab): void;
  setCanvasZoom(z: number): void;
  setCursorMode(m: CursorMode): void;
  setPan(p: { x: number; y: number }): void;
  setNodeState(s: NodeState): void;
  setAppTheme(t: AppTheme): void;
  setDesignMode(m: DesignMode): void;
  refreshAnnotations(): Promise<void>;
  refreshNotes(): Promise<void>;
  setAnnotationsVisible(b: boolean): void;
  setEditingMarkupId(id: string | null): void;
  setFocusedAnnotationId(id: string | null): void;
  setNodeRects(
    screenId: string,
    rects: { path: string; x: number; y: number; w: number; h: number }[],
  ): void;
}

export function selectedNode(
  screens: Record<string, Screen>,
  sel: Selection | null,
): Node | null {
  if (!sel) return null;
  const screen = screens[sel.screenId];
  if (!screen) return null;
  const path = pathFromString(sel.path);
  let node: Node | undefined = screen.tree;
  for (const idx of path) {
    if (!node || !("$ref" in node)) return null;
    const children: Node[] | undefined = node.children;
    if (!children || idx < 0 || idx >= children.length) return null;
    node = children[idx];
  }
  return node ?? null;
}

export const useCanvas = create<CanvasState>((set, get) => ({
  design: null,
  screens: {},
  board: null,
  currentScreenId: null,
  screenVersion: 0,
  components: null,
  theme: null,
  themeVersion: 0,
  presets: [],
  selection: null,
  hover: null,
  wsConnected: false,
  rightTab: "node",
  canvasZoom: 0.75,
  cursorMode: "select",
  pan: { x: 0, y: 0 },
  nodeState: "default",
  appTheme: readAppTheme(),
  history: { undo: 0, redo: 0 },
  designMode: "light",
  annotations: [],
  notes: [],
  nodeRects: {},
  annotationsVisible: true,
  editingMarkupId: null,
  focusedAnnotationId: null,

  async refreshHistory() {
    try {
      const history = await fetchHistory();
      set({ history });
    } catch {
      /* ignore */
    }
  },

  async loadDesign() {
    const design = await fetchDesign();
    set({ design, board: design.board });
    const ids = new Set<string>();
    for (const f of design.board.frames) ids.add(f.screen);
    for (const id of ids) await get().loadScreen(id);
    const prefersDefault =
      design.defaultScreen && design.screens.some((s) => s.id === design.defaultScreen)
        ? design.defaultScreen
        : null;
    const next = get().currentScreenId ?? prefersDefault ?? design.screens[0]?.id ?? null;
    if (next) await get().selectScreen(next);
    await get().loadTheme();
    await get().refreshHistory();
    await get().refreshNotes();
  },

  async refreshDesignSummary() {
    const design = await fetchDesign();
    set({ design, board: design.board });
  },

  async loadComponents() {
    if (get().components) return;
    set({ components: await fetchComponents() });
  },

  async loadTheme() {
    const [theme, { presets }] = await Promise.all([fetchTheme(), fetchPresets()]);
    set({ theme, presets, themeVersion: get().themeVersion + 1 });
  },

  async refreshTheme() {
    const theme = await fetchTheme();
    set({ theme, themeVersion: get().themeVersion + 1 });
  },

  async loadScreen(screenId: string): Promise<Screen | null> {
    try {
      const screen = await fetchScreen(screenId);
      set((s) => ({
        screens: { ...s.screens, [screenId]: screen },
        screenVersion: s.screenVersion + 1,
      }));
      return screen;
    } catch {
      return null;
    }
  },

  async refreshBoard() {
    const { fetchBoard } = await import("./api.ts");
    try {
      const board = await fetchBoard();
      set({ board });
    } catch {
      /* ignore */
    }
  },

  async selectScreen(screenId: string) {
    let screen = get().screens[screenId];
    if (!screen) {
      const loaded = await get().loadScreen(screenId);
      if (!loaded) return;
      screen = loaded;
    }
    set({
      currentScreenId: screenId,
      selection: null,
      hover: null,
      annotations: [],
      editingMarkupId: null,
    });
    await get().refreshAnnotations();
  },

  async refreshCurrentScreen() {
    const id = get().currentScreenId;
    if (!id) return;
    await get().refreshScreen(id);
  },

  async refreshScreen(screenId: string) {
    try {
      const screen = await fetchScreen(screenId);
      set((s) => ({
        screens: { ...s.screens, [screenId]: screen },
        screenVersion: s.screenVersion + 1,
      }));
      if (screenId === get().currentScreenId) await get().refreshAnnotations();
    } catch {
      await get().loadDesign();
    }
  },

  async refreshAnnotations() {
    const id = get().currentScreenId;
    if (!id) return;
    try {
      const { fetchAnnotations } = await import("./api.ts");
      const annotations = await fetchAnnotations(id);
      set({ annotations });
    } catch {
      /* ignore */
    }
  },

  async refreshNotes() {
    try {
      const { fetchNotes } = await import("./api.ts");
      const notes = await fetchNotes();
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

  setFocusedAnnotationId(focusedAnnotationId) {
    set({ focusedAnnotationId });
  },

  setNodeRects(screenId, rects) {
    set((s) => {
      const next: Record<string, { x: number; y: number; w: number; h: number }> = {};
      for (const r of rects) next[r.path] = { x: r.x, y: r.y, w: r.w, h: r.h };
      return { nodeRects: { ...s.nodeRects, [screenId]: next } };
    });
  },

  setSelection(selection) {
    set({ selection });
  },

  setHover(hover) {
    set({ hover });
  },

  setWsConnected(wsConnected) {
    set({ wsConnected });
  },

  setRightTab(rightTab) {
    set({ rightTab });
  },

  setCanvasZoom(canvasZoom) {
    set({ canvasZoom: Math.max(0.1, Math.min(4, canvasZoom)) });
  },

  setCursorMode(cursorMode) {
    if (cursorMode === "hand" || cursorMode === "annotate") {
      set({ cursorMode, hover: null, selection: null, nodeState: "default" });
    } else {
      set({ cursorMode, hover: null });
    }
  },

  setPan(pan) {
    set({ pan });
  },

  setNodeState(nodeState) {
    set({ nodeState });
  },

  setAppTheme(appTheme) {
    set({ appTheme });
    if (typeof localStorage !== "undefined") localStorage.setItem(APP_THEME_KEY, appTheme);
  },

  setDesignMode(designMode) {
    set({ designMode });
  },
}));
