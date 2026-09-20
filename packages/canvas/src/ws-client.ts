import { parseSocketFrame } from "@velloo/protocol";
import { setApiConnected } from "./api/connection.ts";
import { fetchSnippet } from "./api.ts";
import { parseActivityEntry } from "./store/activity.ts";
import { useCanvas } from "./store.ts";
import { pushToast } from "./toast.ts";

/**
 * Socket frames are the server's `WatchEvent` union plus the presentation-only
 * `activity` metadata that rides the same channel. Both the union and
 * its runtime validator come from `@velloo/protocol` — this file used to carry
 * a hand-typed copy of the server's declaration with nothing checking the two
 * agreed, and validated a frame by asserting `as ServerEvent` after testing
 * only that `type` was a string.
 */

export function connectWs(): () => void {
  let socket: WebSocket | null = null;
  let stopped = false;
  let retryDelay = 250;

  function open() {
    if (stopped) return;
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${proto}//${window.location.host}/ws`;
    socket = new WebSocket(url);

    socket.onopen = () => {
      retryDelay = 250;
      setApiConnected(true);
      const state = useCanvas.getState();
      const wasDisconnected = state.wsEverConnected && !state.wsConnected;
      state.setWsConnected(true);
      // Recover automatically: a failed boot retries in full; an established
      // session refetches everything that may have changed while away.
      if (state.design === null) {
        if (state.bootError !== null) void state.loadDesign();
      } else if (wasDisconnected) {
        void state.resyncAfterReconnect();
      }
    };

    socket.onmessage = (ev) => {
      const payload = parseSocketFrame(ev.data);
      if (!payload) return;
      // Activity events are presentation-only metadata riding the same
      // channel — they never trigger refreshes; WatchEvents do.
      if (payload.type === "activity") {
        const entry = parseActivityEntry(payload);
        if (entry) useCanvas.getState().recordActivity(entry);
        return;
      }
      const {
        currentScreenId,
        currentBoardId,
        refreshScreen,
        refreshBoard,
        refreshDesignSummary,
        refreshHistory,
        refreshTheme,
        refreshAnnotations,
        refreshNotes,
        refreshComments,
        screens,
        boards,
      } = useCanvas.getState();
      void refreshHistory();
      if (payload.type === "screen-changed") {
        if (payload.screenId in screens) void refreshScreen(payload.screenId);
        else void refreshDesignSummary();
      } else if (payload.type === "board-changed") {
        if (payload.boardId in boards) void refreshBoard(payload.boardId);
        else void refreshDesignSummary();
      } else if (payload.type === "theme-changed") {
        void refreshTheme();
      } else if (payload.type === "snippet-changed") {
        void refreshDesignSummary();
        if (currentScreenId) void refreshScreen(currentScreenId);
        // Re-pull the body into its synthetic screen when this snippet is the
        // one being edited — either in the editor view, or in place on a board.
        const state = useCanvas.getState();
        if (
          state.editingSnippetId === payload.snippetId ||
          state.snippetFocus === payload.snippetId
        ) {
          void (async () => {
            try {
              const s = await fetchSnippet(payload.snippetId);
              useCanvas.getState().setSyntheticScreen(`snippet:${payload.snippetId}`, {
                id: `snippet:${payload.snippetId}`,
                name: s.name,
                tree: s.tree,
                ...(s.library ? { library: s.library } : {}),
              });
            } catch {
              /* the snippet may have been deleted; ignore */
            }
          })();
        }
      } else if (payload.type === "annotations-changed") {
        // Board-scoped annotations: refresh when any frame on the current
        // board hosts the changed screen (not only currentScreenId).
        const board = currentBoardId ? boards[currentBoardId] : null;
        if (board?.frames.some((f) => f.screen === payload.screenId)) void refreshAnnotations();
        else if (!board && payload.screenId === currentScreenId) void refreshAnnotations();
      } else if (payload.type === "notes-changed") {
        if (payload.boardId === currentBoardId) void refreshNotes();
      } else if (payload.type === "comments-changed") {
        if (payload.boardId === currentBoardId) void refreshComments();
      } else if (payload.type === "config-changed") {
        // Extensions / library config changed — the Library tab reads
        // from the design summary.
        void refreshDesignSummary();
        // An agent (or a second tab) can edit config while the settings
        // dialog is open; reload it so the dialog isn't showing stale values.
        if (useCanvas.getState().folderConfig) void useCanvas.getState().loadFolderConfig();
        // Host apps and repo overrides live in config.
        void useCanvas.getState().reloadRepoCatalog();
      } else if (payload.type === "folder-reloaded") {
        // Host component source changed under every frame: drop every
        // cache and boot again.
        void useCanvas.getState().reloadAll();
        void useCanvas.getState().reloadRepoCatalog();
      } else if (payload.type === "reload-error") {
        pushToast({
          kind: "error",
          title: "File change not applied",
          message: `${payload.source}: ${payload.message}`,
          ttl: 8000,
        });
      }
    };

    socket.onclose = () => {
      setApiConnected(false);
      useCanvas.getState().setWsConnected(false);
      if (stopped) return;
      setTimeout(open, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 5000);
    };

    socket.onerror = () => {
      socket?.close();
    };
  }

  open();
  return () => {
    stopped = true;
    socket?.close();
  };
}
