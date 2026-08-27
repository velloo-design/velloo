import type { Manifest, StyleChannel } from "@velloo/provider";
import type { Board, Screen, Theme } from "@velloo/schema";
import type { StateCreator } from "zustand";
import {
  type BoardMeta,
  type DesignSummary,
  fetchBoard,
  fetchComponents,
  fetchDesign,
  fetchHistory,
  fetchPresets,
  fetchScreen,
  fetchTheme,
  type HistoryDepths,
} from "../api.ts";
import type { CanvasState } from "./index.ts";

/**
 * The data core: design summary, boards + screens, components manifest, theme,
 * undo/redo depths, and the WS connection flag — everything loaded from (and
 * refreshed against) the server.
 */
export interface DesignSlice {
  design: DesignSummary | null;
  screens: Record<string, Screen>;
  boards: Record<string, Board>;
  currentBoardId: string | null;
  currentScreenId: string | null;
  screenVersion: number;
  /**
   * Per-screen render version, bumped only for the screen that changed. The
   * frame iframe cache-buster keys on this so editing one screen reloads only
   * its own frames' iframes — not every frame on the board (which the global
   * `screenVersion` would do).
   */
  screenVersions: Record<string, number>;
  components: Manifest | null;
  /** Default library's native style channel — drives the inspector's style editor. */
  styleChannel: StyleChannel | null;
  /** Per-library channels, so a multi-library folder edits each screen in its own channel. */
  channelsByLibrary: Record<string, StyleChannel>;
  theme: Theme | null;
  themeVersion: number;
  presets: string[];
  history: HistoryDepths;
  wsConnected: boolean;

  /**
   * Boot the store from the server. `seed` carries the URL's board/screen
   * (`?board=…&screen=…`) so a shared link selects its board directly —
   * selecting the default first and switching after would flash the wrong
   * board and eagerly load its screens for nothing.
   */
  loadDesign(seed?: { boardId?: string | null; screenId?: string | null }): Promise<void>;
  refreshHistory(): Promise<void>;
  refreshDesignSummary(): Promise<void>;
  /**
   * Reorder `design.boards` in place to match `order` (board ids). Used
   * by the sidebar drag-and-drop for an optimistic update before the
   * reorder mutation round-trips; the server's `config-changed` event
   * later reconciles via `refreshDesignSummary`.
   */
  reorderBoardsLocal(order: string[]): void;
  loadComponents(): Promise<void>;
  loadTheme(): Promise<void>;
  refreshTheme(): Promise<void>;
  selectBoard(boardId: string): Promise<void>;
  loadBoard(boardId: string): Promise<Board | null>;
  refreshBoard(boardId: string): Promise<void>;
  /**
   * Drop a deleted board from local state: the summary list, the loaded-board
   * cache, and — when it was the active board — the selection, which moves to
   * the first remaining board.
   */
  pruneBoard(boardId: string): Promise<void>;
  selectScreen(screenId: string): Promise<void>;
  loadScreen(screenId: string): Promise<Screen | null>;
  refreshScreen(screenId: string): Promise<void>;
  setWsConnected(b: boolean): void;
}

export const createDesignSlice: StateCreator<CanvasState, [], [], DesignSlice> = (set, get) => ({
  design: null,
  screens: {},
  boards: {},
  currentBoardId: null,
  currentScreenId: null,
  screenVersion: 0,
  screenVersions: {},
  components: null,
  styleChannel: null,
  channelsByLibrary: {},
  theme: null,
  themeVersion: 0,
  presets: [],
  history: { undo: 0, redo: 0 },
  wsConnected: false,

  async refreshHistory() {
    try {
      const history = await fetchHistory();
      set({ history });
    } catch {
      /* ignore */
    }
  },

  async loadDesign(seed) {
    const design = await fetchDesign();
    set({ design });
    // Boards: URL seed (when it still exists) beats default beats first.
    const seedBoard =
      seed?.boardId && design.boards.some((b) => b.id === seed.boardId) ? seed.boardId : null;
    const prefersBoard =
      design.defaultBoard && design.boards.some((b) => b.id === design.defaultBoard)
        ? design.defaultBoard
        : null;
    const nextBoardId =
      seedBoard ?? get().currentBoardId ?? prefersBoard ?? design.boards[0]?.id ?? null;
    // selectBoard handles screen coercion: if the current screen isn't
    // placed on the new board, it switches to the board's first frame.
    if (nextBoardId) await get().selectBoard(nextBoardId);
    const seedScreen =
      seed?.screenId && design.screens.some((s) => s.id === seed.screenId) ? seed.screenId : null;
    if (seedScreen && seedScreen !== get().currentScreenId) await get().selectScreen(seedScreen);
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

  reorderBoardsLocal(order) {
    set((s) => {
      if (!s.design) return s;
      const byId = new Map(s.design.boards.map((b) => [b.id, b]));
      const next: BoardMeta[] = [];
      for (const id of order) {
        const b = byId.get(id);
        if (b) {
          next.push(b);
          byId.delete(id);
        }
      }
      // Any board not named in `order` keeps its place at the end.
      for (const b of s.design.boards) if (byId.has(b.id)) next.push(b);
      return { design: { ...s.design, boards: next } };
    });
  },

  async loadComponents() {
    if (get().components) return;
    const { manifest, styleChannel, channelsByLibrary } = await fetchComponents();
    set({ components: manifest, styleChannel, channelsByLibrary });
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
        screenVersions: { ...s.screenVersions, [screenId]: (s.screenVersions[screenId] ?? 0) + 1 },
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
      // Sync the summary's meta too — the sidebar reads name + frame count
      // from `design.boards`, and a rename or frame change only broadcasts
      // `board-changed`.
      set((s) => ({
        boards: { ...s.boards, [boardId]: board },
        design: s.design
          ? {
              ...s.design,
              boards: s.design.boards.map((b) =>
                b.id === boardId ? { ...b, name: board.name, frameCount: board.frames.length } : b,
              ),
            }
          : s.design,
      }));
      for (const f of board.frames) {
        if (!get().screens[f.screen]) await get().loadScreen(f.screen);
      }
    } catch {
      // A deleted board also broadcasts `board-changed`, so this fetch 404s.
      // Confirm against a fresh summary before pruning so a transient
      // failure doesn't drop a live board.
      try {
        const design = await fetchDesign();
        set({ design });
        if (!design.boards.some((b) => b.id === boardId)) await get().pruneBoard(boardId);
      } catch {
        /* ignore */
      }
    }
  },

  async pruneBoard(boardId: string) {
    set((s) => {
      const { [boardId]: _removed, ...boards } = s.boards;
      return {
        boards,
        design: s.design
          ? { ...s.design, boards: s.design.boards.filter((b) => b.id !== boardId) }
          : s.design,
      };
    });
    if (get().currentBoardId !== boardId) return;
    const next = get().design?.boards[0]?.id ?? null;
    if (next) {
      await get().selectBoard(next);
    } else {
      set({
        currentBoardId: null,
        currentScreenId: null,
        annotations: [],
        editingMarkupId: null,
        notes: [],
      });
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
        screenVersions: { ...s.screenVersions, [screenId]: (s.screenVersions[screenId] ?? 0) + 1 },
      }));
      if (screenId === get().currentScreenId) await get().refreshAnnotations();
    } catch {
      await get().loadDesign();
    }
  },

  setWsConnected(wsConnected) {
    set({ wsConnected });
  },
});
