import { setApiConnected } from "./api/connection.ts";
import { parseActivityEntry } from "./store/activity.ts";
import { useCanvas } from "./store.ts";
import { pushToast } from "./toast.ts";

type ServerEvent =
  | { type: "screen-changed"; screenId: string }
  | { type: "board-changed"; boardId: string }
  | { type: "theme-changed" }
  | { type: "snippet-changed"; snippetId: string }
  | { type: "annotations-changed"; screenId: string }
  | { type: "notes-changed"; boardId: string }
  | { type: "config-changed" }
  | { type: "folder-reloaded" }
  | { type: "reload-error"; source: string; message: string }
  /** Agent-activity metadata — validated separately by parseActivityEntry. */
  | { type: "activity" };

/**
 * Validate a raw WebSocket frame at the trust boundary: it must be a JSON
 * object carrying a string `type` discriminant before the dispatch below can
 * safely narrow on it. Anything else (non-string data, malformed JSON, a
 * payload without `type`) is dropped.
 */
function parseServerEvent(data: unknown): ServerEvent | null {
  if (typeof data !== "string") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  if (typeof (parsed as { type?: unknown }).type !== "string") return null;
  return parsed as ServerEvent;
}

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
      const payload = parseServerEvent(ev.data);
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
        // If the snippet currently open in the editor view is the one
        // that changed, re-pull the body into its synthetic screen.
        const editingId = useCanvas.getState().editingSnippetId;
        if (editingId === payload.snippetId) {
          void (async () => {
            const { fetchSnippet } = await import("./api.ts");
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
        if (payload.screenId === currentScreenId) void refreshAnnotations();
      } else if (payload.type === "notes-changed") {
        if (payload.boardId === currentBoardId) void refreshNotes();
      } else if (payload.type === "config-changed") {
        // Extensions / library config changed — the Library tab reads
        // from the design summary.
        void refreshDesignSummary();
      } else if (payload.type === "folder-reloaded") {
        // Out-of-band rewrite of the whole folder (git revert-all): drop
        // every cache and boot again.
        void useCanvas.getState().reloadAll();
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
