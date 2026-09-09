import type { Manifest, StyleChannel } from "@velloo/provider";
import type { Board, Screen, Theme } from "@velloo/schema";
import type { Typeset } from "@velloo/schema/typeset";
import type { StateCreator } from "zustand";
import {
  type BoardMeta,
  type DesignSummary,
  type FolderConfig,
  fetchBoard,
  fetchComponents,
  fetchConfig,
  fetchDesign,
  fetchGeneratedAssets,
  fetchHistory,
  fetchPresets,
  fetchScreen,
  fetchTheme,
  type GeneratedAsset,
  type HistoryDepths,
  mutate,
} from "../api.ts";
import { readLastBoard, writeLastBoard } from "../board-memory.ts";
import type { FontDraft } from "../font-draft.ts";
import type { CanvasState } from "./index.ts";

/**
 * The theme the board on screen renders with.
 *
 * Frames pass `Board.theme` to the render route, so the theme panel has to read
 * and write that same one. Reading the folder default while the frames render a
 * pinned theme is the bug where dragging a rhythm control changes a file
 * nothing on screen uses, and so appears to do nothing at all.
 */
function activeThemeName(state: Pick<CanvasState, "currentBoardId" | "boards">): string {
  const boardId = state.currentBoardId;
  return (boardId ? state.boards[boardId]?.theme : undefined) ?? "default";
}

/**
 * The data core: design summary, boards + screens, components manifest, theme,
 * undo/redo depths, and the WS connection flag — everything loaded from (and
 * refreshed against) the server.
 */
export interface DesignSlice {
  design: DesignSummary | null;
  /**
   * The folder's settings, loaded on demand by the settings dialog rather
   * than at boot — nothing else reads them. Null until first opened.
   */
  folderConfig: FolderConfig | null;
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
  /**
   * Provenance for velloo-generated assets, keyed by folder-relative path
   * ("assets/hero.png"). An image whose src isn't a key here is one velloo
   * didn't generate — which is exactly the distinction the image panel draws.
   */
  generatedAssets: Record<string, GeneratedAsset>;
  /** Default library's native style channel — drives the inspector's style editor. */
  styleChannel: StyleChannel | null;
  /** Per-library channels, so a multi-library folder edits each screen in its own channel. */
  channelsByLibrary: Record<string, StyleChannel>;
  /**
   * The theme the active board renders with — the folder default, or the one
   * that board pins. Panel edits target `theme.name`, so this is the object the
   * frames on screen are actually styled by rather than always `default.json`.
   */
  theme: Theme | null;
  /**
   * Which `theme/<name>.json` the loaded theme came from, and so the target of
   * every panel edit.
   *
   * Tracked separately from `theme.name` because that field is content, not
   * identity: applying the `violet` preset leaves `default.json` named
   * "violet". Using it as the write target would send edits to a theme file
   * that doesn't exist.
   */
  themeName: string;
  themeVersion: number;
  /**
   * A typeset being dragged in the theme panel, before it is committed.
   *
   * Every frame paints it as a CSS-variable override in its own iframe
   * document, which re-rhythms the whole board without reloading anything —
   * the derived ladder is declared in the same rule as the three authored
   * controls, so overriding those re-substitutes the rest. Cleared on
   * pointer-up, when the committed theme arrives the normal way.
   */
  typesetDraft: { name: string; typeset: Typeset } | null;
  /**
   * A font role being previewed from the font browser, before it is committed.
   * Painted into every frame the same way as `typesetDraft`, with a webfont
   * link alongside the variable override.
   */
  fontDraft: FontDraft | null;
  presets: string[];
  history: HistoryDepths;
  wsConnected: boolean;
  /**
   * True once the WS has connected at least once this session — the
   * disconnected banner keys on it so the brief pre-handshake window at boot
   * doesn't flash "disconnected" chrome.
   */
  wsEverConnected: boolean;
  /** Boot failure message when the initial loadDesign couldn't reach the daemon. */
  bootError: string | null;

  /**
   * Boot the store from the server. `seed` carries the URL's board/screen
   * (`?board=…&screen=…`) so a shared link selects its board directly —
   * selecting the default first and switching after would flash the wrong
   * board and eagerly load its screens for nothing.
   */
  loadDesign(seed?: { boardId?: string | null; screenId?: string | null }): Promise<void>;
  refreshHistory(): Promise<void>;
  refreshDesignSummary(): Promise<void>;
  /** Load (or reload) `folderConfig`. */
  loadFolderConfig(): Promise<void>;
  /**
   * Reorder `design.boards` in place to match `order` (board ids). Used
   * by the sidebar drag-and-drop for an optimistic update before the
   * reorder mutation round-trips; the server's `config-changed` event
   * later reconciles via `refreshDesignSummary`.
   */
  reorderBoardsLocal(order: string[]): void;
  loadComponents(): Promise<void>;
  /** Refetch assets.json — after a generation, and on boot. */
  loadGeneratedAssets(): Promise<void>;
  loadTheme(): Promise<void>;
  refreshTheme(): Promise<void>;
  /**
   * Reload the theme when the board on screen has come to render with a
   * different one — after a board switch, or after its pin changed here or
   * from an agent.
   */
  syncThemeToBoard(): Promise<void>;
  /** Paint (or clear, with null) an uncommitted typeset across every frame. */
  setTypesetDraft(draft: { name: string; typeset: Typeset } | null): void;
  /** Paint (or clear, with null) a font role being tried on across every frame. */
  setFontDraft(draft: FontDraft | null): void;
  selectBoard(boardId: string): Promise<void>;
  loadBoard(boardId: string): Promise<Board | null>;
  refreshBoard(boardId: string): Promise<void>;
  /**
   * Drop a deleted board from local state: the summary list, the loaded-board
   * cache, and — when it was the active board — the selection, which moves to
   * the first remaining board.
   */
  pruneBoard(boardId: string): Promise<void>;
  /**
   * Drop deleted screens from local state: the summary list and the loaded
   * cache. Board deletion takes the screens only it placed, so the initiator
   * knows which ids went before any broadcast lands.
   */
  pruneScreens(screenIds: string[]): void;
  /**
   * File a board away (or bring it back). Archived boards leave the sidebar's
   * main list but stay on disk and fully editable; archiving the board you're
   * looking at moves the selection to the first remaining live board.
   */
  setBoardArchived(boardId: string, archived: boolean): Promise<void>;
  selectScreen(screenId: string): Promise<void>;
  loadScreen(screenId: string): Promise<Screen | null>;
  refreshScreen(screenId: string): Promise<void>;
  setWsConnected(b: boolean): void;
  /**
   * Refetch everything the canvas holds after a WS reconnect: the daemon may
   * have restarted (fresh history) or the folder may have changed while we
   * were away. Loaded screens/boards refresh in place, bumping their render
   * versions so stale iframes reload.
   */
  resyncAfterReconnect(): Promise<void>;
  /**
   * Full reload after an out-of-band rewrite of the design folder (git
   * revert-all): drop every cached board/screen and boot again, keeping the
   * current board/screen only if they still exist.
   */
  reloadAll(): Promise<void>;
}

export const createDesignSlice: StateCreator<CanvasState, [], [], DesignSlice> = (set, get) => ({
  design: null,
  folderConfig: null,
  screens: {},
  boards: {},
  currentBoardId: null,
  currentScreenId: null,
  screenVersion: 0,
  screenVersions: {},
  components: null,
  generatedAssets: {},
  styleChannel: null,
  channelsByLibrary: {},
  theme: null,
  themeName: "default",
  themeVersion: 0,
  typesetDraft: null,
  fontDraft: null,
  presets: [],
  history: { undo: 0, redo: 0 },
  wsConnected: false,
  wsEverConnected: false,
  bootError: null,

  async refreshHistory() {
    try {
      const history = await fetchHistory();
      set({ history });
    } catch {
      /* ignore */
    }
  },

  async loadDesign(seed) {
    let design: DesignSummary;
    try {
      design = await fetchDesign();
    } catch (err) {
      // Server down at boot: a clear error state with retry instead of an
      // unhandled rejection and an empty canvas.
      set({ bootError: err instanceof Error ? err.message : String(err) });
      return;
    }
    set({ design, bootError: null });
    // Boards: a URL seed is where the user asked to go, so it wins; a
    // configured `defaultBoard` is a deliberate "always open here" and beats
    // this browser's memory of where it left off; the first board is the last
    // resort. Every candidate is checked against the live boards — any of them
    // can name one archived or deleted since.
    const exists = (id: string | null | undefined) =>
      id && design.boards.some((b) => b.id === id) ? id : null;
    const nextBoardId =
      exists(seed?.boardId) ??
      get().currentBoardId ??
      exists(design.defaultBoard) ??
      exists(readLastBoard()) ??
      design.boards[0]?.id ??
      null;
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

  async loadFolderConfig() {
    set({ folderConfig: await fetchConfig() });
  },

  async setBoardArchived(boardId: string, archived: boolean) {
    await mutate.updateBoard({ boardId, patch: { archived } });
    // Archiving moves the board between two summary lists, which no
    // `board-changed` reconciliation covers — refetch the summary rather
    // than reimplementing the server's ordering here.
    await get().refreshDesignSummary();
    if (!archived || get().currentBoardId !== boardId) return;
    const next = get().design?.boards[0]?.id ?? null;
    if (next) {
      await get().selectBoard(next);
    } else {
      // Everything's archived — clear the canvas rather than opening onto a
      // board the user just put away.
      set({
        currentBoardId: null,
        currentScreenId: null,
        annotations: [],
        notes: [],
        commentThreads: [],
      });
      get().setEditingMarkupId(null);
    }
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

  async loadGeneratedAssets() {
    // Provenance is an enhancement: a folder with no assets.json, or a daemon
    // too old to serve the route, must leave the inspector working.
    try {
      set({ generatedAssets: await fetchGeneratedAssets() });
    } catch {
      set({ generatedAssets: {} });
    }
  },

  async loadTheme() {
    const themeName = activeThemeName(get());
    const [theme, { presets }] = await Promise.all([fetchTheme(themeName), fetchPresets()]);
    set({ theme, themeName, presets, themeVersion: get().themeVersion + 1 });
  },

  async refreshTheme() {
    const themeName = activeThemeName(get());
    const theme = await fetchTheme(themeName);
    // The committed stylesheet now carries whatever the drafts were previewing,
    // so drop them rather than leaving duplicate overrides on top.
    set({
      theme,
      themeName,
      typesetDraft: null,
      fontDraft: null,
      themeVersion: get().themeVersion + 1,
    });
  },

  async syncThemeToBoard() {
    // `theme` null means boot hasn't loaded one yet, and loadTheme is coming
    // anyway — refetching here would just double the request.
    if (get().theme && get().themeName !== activeThemeName(get())) await get().loadTheme();
  },

  setTypesetDraft(typesetDraft) {
    set({ typesetDraft });
  },

  setFontDraft(fontDraft) {
    set({ fontDraft });
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
                b.id === boardId
                  ? {
                      ...b,
                      name: board.name,
                      frameCount: board.frames.length,
                      group: board.group ?? null,
                    }
                  : b,
              ),
            }
          : s.design,
      }));
      // An archive/unarchive elsewhere (another tab, an agent) also arrives as
      // `board-changed`, but it moves the board between the summary's two
      // lists — which the in-place patch above can't express. Only refetch
      // when the flag actually disagrees with what we're showing.
      const design = get().design;
      if (design) {
        const shown = design.boards.some((b) => b.id === boardId);
        if (shown === Boolean(board.archivedAt)) await get().refreshDesignSummary();
      }
      for (const f of board.frames) {
        if (!get().screens[f.screen]) await get().loadScreen(f.screen);
      }
      // Repointing a board at another theme arrives here too — from the theme
      // switcher, or from an agent's `update_board`.
      if (boardId === get().currentBoardId) await get().syncThemeToBoard();
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
        notes: [],
      });
      get().setEditingMarkupId(null);
    }
  },

  pruneScreens(screenIds: string[]) {
    if (screenIds.length === 0) return;
    const gone = new Set(screenIds);
    set((s) => {
      const screens = Object.fromEntries(Object.entries(s.screens).filter(([id]) => !gone.has(id)));
      return {
        screens,
        design: s.design
          ? { ...s.design, screens: s.design.screens.filter((sc) => !gone.has(sc.id)) }
          : s.design,
        // pruneBoard re-selects right after and picks a screen off the next
        // board, but it only looks at `currentScreenId` — leaving a deleted id
        // there would read as "already on a valid screen".
        ...(s.currentScreenId && gone.has(s.currentScreenId)
          ? { currentScreenId: null, annotations: [] }
          : {}),
      };
    });
  },

  async selectBoard(boardId: string) {
    let board = get().boards[boardId];
    if (!board) {
      const loaded = await get().loadBoard(boardId);
      if (!loaded) return;
      board = loaded;
    }
    set({ currentBoardId: boardId, notes: [], commentThreads: [], activeCommentId: null });
    // The board to reopen next time. Written here rather than at the call
    // sites so every route in — sidebar, search, back button, boot — counts.
    writeLastBoard(boardId);
    // Keep the sidebar Tree scoped to the active board. If the current
    // screen isn't placed on this board, jump to the first frame's
    // screen — or clear the screen entirely when the board is empty.
    const screenIdsOnBoard = new Set(board.frames.map((f) => f.screen));
    const current = get().currentScreenId;
    if (board.frames.length === 0) {
      if (current) {
        set({ currentScreenId: null, annotations: [] });
        get().setEditingMarkupId(null);
      }
    } else if (!current || !screenIdsOnBoard.has(current)) {
      const firstScreen = board.frames[0]?.screen;
      if (firstScreen) await get().selectScreen(firstScreen);
    } else {
      // Same screen, new board — reload annotations for this board's frames.
      await get().refreshAnnotations();
    }
    await get().refreshNotes();
    await get().refreshComments();
    // Boards can pin their own theme, so switching board can change which one
    // the panel is editing.
    await get().syncThemeToBoard();
  },

  async selectScreen(screenId: string) {
    let screen = get().screens[screenId];
    if (!screen) {
      const loaded = await get().loadScreen(screenId);
      if (!loaded) return;
      screen = loaded;
    }
    // Drop in-progress markup edit when the tree context changes — routes
    // through setEditingMarkupId so the soft-zoom restore still runs.
    get().setEditingMarkupId(null);
    set({ currentScreenId: screenId });
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
      const boardId = get().currentBoardId;
      const board = boardId ? get().boards[boardId] : null;
      if (board?.frames.some((f) => f.screen === screenId)) await get().refreshAnnotations();
      if (board?.frames.some((f) => f.screen === screenId)) await get().refreshComments();
    } catch {
      await get().loadDesign();
    }
  },

  setWsConnected(wsConnected) {
    set((s) => ({ wsConnected, wsEverConnected: s.wsEverConnected || wsConnected }));
  },

  async resyncAfterReconnect() {
    try {
      await get().refreshDesignSummary();
      await get().refreshTheme();
      await get().refreshHistory();
      const boardId = get().currentBoardId;
      if (boardId) await get().refreshBoard(boardId);
      // Refresh every real screen already in the cache (skip synthetic
      // snippet-editor screens) so frames re-render whatever changed while
      // the daemon was away.
      for (const screenId of Object.keys(get().screens)) {
        if (screenId.startsWith("snippet:")) continue;
        await get().refreshScreen(screenId);
      }
      await get().refreshAnnotations();
      await get().refreshNotes();
      await get().refreshComments();
    } catch {
      // Reconnect resync is best-effort; the WS will retry on next connect.
    }
  },

  async reloadAll() {
    const design = await fetchDesign();
    const boardId = get().currentBoardId;
    const screenId = get().currentScreenId;
    set({
      design,
      screens: {},
      boards: {},
      currentBoardId: boardId && design.boards.some((b) => b.id === boardId) ? boardId : null,
      currentScreenId: screenId && design.screens.some((s) => s.id === screenId) ? screenId : null,
      annotations: [],
      notes: [],
      commentThreads: [],
      activeCommentId: null,
    });
    get().setEditingMarkupId(null);
    await get().loadDesign();
  },
});
