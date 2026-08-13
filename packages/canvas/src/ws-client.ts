import { useCanvas } from "./store.ts";

type ServerEvent =
  | { type: "screen-changed"; screenId: string }
  | { type: "board-changed" }
  | { type: "theme-changed" }
  | { type: "snippet-changed"; snippetId: string }
  | { type: "annotations-changed"; screenId: string }
  | { type: "notes-changed" };

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
      useCanvas.getState().setWsConnected(true);
    };

    socket.onmessage = (ev) => {
      let payload: ServerEvent;
      try {
        payload = JSON.parse(ev.data) as ServerEvent;
      } catch {
        return;
      }
      const {
        currentScreenId,
        refreshScreen,
        refreshBoard,
        refreshDesignSummary,
        refreshHistory,
        refreshTheme,
        refreshAnnotations,
        refreshNotes,
        screens,
      } = useCanvas.getState();
      void refreshHistory();
      if (payload.type === "screen-changed") {
        // Refresh if this screen is loaded — even if it's not the current one,
        // any frame on the board rendering it needs to update.
        if (payload.screenId in screens) {
          void refreshScreen(payload.screenId);
        } else {
          void refreshDesignSummary();
        }
      } else if (payload.type === "board-changed") {
        void refreshBoard();
      } else if (payload.type === "theme-changed") {
        void refreshTheme();
      } else if (payload.type === "snippet-changed") {
        void refreshDesignSummary();
        // Snippets may affect any loaded screen — refresh current at minimum.
        if (currentScreenId) void refreshScreen(currentScreenId);
      } else if (payload.type === "annotations-changed") {
        if (payload.screenId === currentScreenId) void refreshAnnotations();
      } else if (payload.type === "notes-changed") {
        void refreshNotes();
      }
    };

    socket.onclose = () => {
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
