import type { Manifest } from "@velloo/provider";
import type { Board, Node, Screen, Theme } from "@velloo/schema";
import { create } from "zustand";
import {
  type DesignSummary,
  fetchBoard,
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
export type ViewMode = "boards" | "library" | "snippet";
export type LibraryItemKind = "component" | "snippet";
export interface LibraryItemRef {
  kind: LibraryItemKind;
  id: string;
}

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
  boards: Record<string, Board>;
  currentBoardId: string | null;
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
  /**
   * Reported by each frame's iframe runtime when the canvas asks for
   * geometry. Keyed by frameId so multi-frame screens (same tree at
   * different viewport sizes) don't clobber each other's rects.
   * Coordinates are in iframe-document space — the consumer adds the
   * frame's board-world offset to anchor in the canvas.
   */
  nodeRects: Record<string, Record<string, { x: number; y: number; w: number; h: number }>>;
  annotationsVisible: boolean;
  editingMarkupId: string | null;
  view: ViewMode;
  libraryItem: LibraryItemRef | null;
  /**
   * Snippet currently open in the focused snippet view. When non-null the main
   * area renders the snippet as a single iframe at the chosen viewport, with
   * the right panel scoped to snippet metadata + params. `view` is set to
   * `"snippet"` while this is non-null and snaps back to the prior view on close.
   */
  editingSnippetId: string | null;
  /** View the canvas was on before entering snippet mode; restored on close. */
  preSnippetView: ViewMode | null;

  loadDesign(): Promise<void>;
  refreshHistory(): Promise<void>;
  refreshDesignSummary(): Promise<void>;
  loadComponents(): Promise<void>;
  loadTheme(): Promise<void>;
  refreshTheme(): Promise<void>;
  selectBoard(boardId: string): Promise<void>;
  loadBoard(boardId: string): Promise<Board | null>;
  refreshBoard(boardId: string): Promise<void>;
  selectScreen(screenId: string): Promise<void>;
  loadScreen(screenId: string): Promise<Screen | null>;
  refreshScreen(screenId: string): Promise<void>;
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
  setNodeRects(
    frameId: string,
    rects: { path: string; x: number; y: number; w: number; h: number }[],
  ): void;
  clearNodeRects(frameId: string): void;
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

export function selectedNode(screens: Record<string, Screen>, sel: Selection | null): Node | null {
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

/**
 * Single zustand slice for the canvas. Internally grouped by concern.
 * Action sections:
 *
 *   1. Design / boards / screens — load + refresh from the server
 *   2. Theme — load + refresh
 *   3. Selection + hover
 *   4. Viewport (zoom + pan + cursor mode + node state)
 *   5. App theme + design mode (light/dark)
 *   6. Annotations + canvas notes
 *   7. Connection / right tab / history
 */
export const useCanvas = create<CanvasState>((set, get) => ({
  // ── state: design ────────────────────────────────────────────
  design: null,
  screens: {},
  boards: {},
  currentBoardId: null,
  currentScreenId: null,
  screenVersion: 0,
  components: null,
  // ── state: theme ─────────────────────────────────────────────
  theme: null,
  themeVersion: 0,
  presets: [],
  // ── state: selection ─────────────────────────────────────────
  selection: null,
  hover: null,
  // ── state: connection / chrome ───────────────────────────────
  wsConnected: false,
  rightTab: "node",
  // ── state: viewport ──────────────────────────────────────────
  canvasZoom: 0.75,
  cursorMode: "select",
  pan: { x: 0, y: 0 },
  nodeState: "default",
  // ── state: app theme / design mode ───────────────────────────
  appTheme: readAppTheme(),
  designMode: "light",
  // ── state: history ───────────────────────────────────────────
  history: { undo: 0, redo: 0 },
  // ── state: annotations + notes ───────────────────────────────
  annotations: [],
  notes: [],
  nodeRects: {},
  annotationsVisible: true,
  editingMarkupId: null,
  // ── state: library view ──────────────────────────────────────
  view: "boards",
  libraryItem: null,
  editingSnippetId: null,
  preSnippetView: null,

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
    set({ design });
    // Boards: pick default, else first.
    const prefersBoard =
      design.defaultBoard && design.boards.some((b) => b.id === design.defaultBoard)
        ? design.defaultBoard
        : null;
    const nextBoardId = get().currentBoardId ?? prefersBoard ?? design.boards[0]?.id ?? null;
    // selectBoard handles screen coercion: if the current screen isn't
    // placed on the new board, it switches to the board's first frame.
    if (nextBoardId) await get().selectBoard(nextBoardId);
    // Only fall back to the global default screen if no board ended up
    // scoping the tree (no boards at all, or selectBoard failed). The
    // configured `defaultScreen` may not live on the active board —
    // honouring it there would desync the tree from the canvas.
    if (!get().currentScreenId) {
      const prefersScreen =
        design.defaultScreen && design.screens.some((s) => s.id === design.defaultScreen)
          ? design.defaultScreen
          : null;
      const nextScreen = prefersScreen ?? design.screens[0]?.id ?? null;
      if (nextScreen) await get().selectScreen(nextScreen);
    }
    await get().loadTheme();
    await get().refreshHistory();
  },

  async refreshDesignSummary() {
    const design = await fetchDesign();
    set({ design });
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

  async loadBoard(boardId: string): Promise<Board | null> {
    try {
      const board = await fetchBoard(boardId);
      set((s) => ({ boards: { ...s.boards, [boardId]: board } }));
      // Eagerly load every screen referenced by this board.
      const seen = new Set<string>();
      for (const f of board.frames) seen.add(f.screen);
      for (const id of seen) {
        if (!get().screens[id]) await get().loadScreen(id);
      }
      return board;
    } catch {
      return null;
    }
  },

  async refreshBoard(boardId: string) {
    try {
      const board = await fetchBoard(boardId);
      set((s) => ({ boards: { ...s.boards, [boardId]: board } }));
      for (const f of board.frames) {
        if (!get().screens[f.screen]) await get().loadScreen(f.screen);
      }
    } catch {
      /* ignore */
    }
  },

  async selectBoard(boardId: string) {
    let board = get().boards[boardId];
    if (!board) {
      const loaded = await get().loadBoard(boardId);
      if (!loaded) return;
      board = loaded;
    }
    set({ currentBoardId: boardId, notes: [] });
    // Keep the sidebar Tree scoped to the active board. If the current
    // screen isn't placed on this board, jump to the first frame's
    // screen — or clear the screen entirely when the board is empty.
    const screenIdsOnBoard = new Set(board.frames.map((f) => f.screen));
    const current = get().currentScreenId;
    if (board.frames.length === 0) {
      if (current) set({ currentScreenId: null, annotations: [], editingMarkupId: null });
    } else if (!current || !screenIdsOnBoard.has(current)) {
      const firstScreen = board.frames[0]?.screen;
      if (firstScreen) await get().selectScreen(firstScreen);
    }
    await get().refreshNotes();
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
      annotations: [],
      editingMarkupId: null,
    });
    await get().refreshAnnotations();
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
    const boardId = get().currentBoardId;
    if (!boardId) return;
    try {
      const { fetchNotes } = await import("./api.ts");
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

  setNodeRects(frameId, rects) {
    set((s) => {
      const next: Record<string, { x: number; y: number; w: number; h: number }> = {};
      for (const r of rects) next[r.path] = { x: r.x, y: r.y, w: r.w, h: r.h };
      return { nodeRects: { ...s.nodeRects, [frameId]: next } };
    });
  },

  clearNodeRects(frameId) {
    set((s) => {
      if (!(frameId in s.nodeRects)) return s;
      const { [frameId]: _drop, ...rest } = s.nodeRects;
      void _drop;
      return { nodeRects: rest };
    });
  },

  setSelection(selection) {
    set({ selection });
    // If the selected node lives on a screen other than the currently
    // open one, follow it — otherwise the sidebar Tree shows a tree
    // unrelated to what's selected in the canvas. Annotations follow
    // along too so the right panel stays coherent. Snippet-virtual
    // screen ids (`snippet:<id>`) don't live on disk and are owned by
    // the snippet editor view — skip auto-switching for them.
    if (
      selection &&
      selection.screenId !== get().currentScreenId &&
      !selection.screenId.startsWith("snippet:")
    ) {
      void get().selectScreen(selection.screenId);
    }
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
    if (cursorMode === "annotate") {
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

  setView(view) {
    set({ view, ...(view === "boards" ? { libraryItem: null } : {}) });
    if (view === "library" || view === "snippet") void get().loadComponents();
  },

  openLibrary(item) {
    set({ view: "library", libraryItem: item ?? null });
    void get().loadComponents();
  },

  closeLibrary() {
    set({ view: "boards", libraryItem: null });
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
      };
    });
  },
}));
