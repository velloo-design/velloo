import { useCanvas } from "./store.ts";

type ServerEvent =
  | { type: "page-changed"; pageId: string }
  | { type: "theme-changed" }
  | { type: "snippet-changed"; snippetId: string }
  | { type: "annotations-changed"; pageId: string }
  | { type: "notes-changed"; pageId: string };

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
        currentPageId,
        refreshCurrentPage,
        refreshDesignSummary,
        refreshHistory,
        refreshTheme,
        refreshAnnotations,
        refreshNotes,
      } = useCanvas.getState();
      void refreshHistory();
      if (payload.type === "page-changed") {
        if (payload.pageId === currentPageId) {
          // Same page edited: refresh content without clearing the user's selection.
          void refreshCurrentPage();
        } else {
          // Different page: just refresh the sidebar summary; don't touch currentPage/selection.
          void refreshDesignSummary();
        }
      } else if (payload.type === "theme-changed") {
        void refreshTheme();
        void refreshCurrentPage();
      } else if (payload.type === "snippet-changed") {
        // Snippets affect any page that instantiates them. Refresh both the
        // sidebar summary (so the snippets list reflects add/remove) and the
        // current page render (so instances pick up body edits).
        void refreshDesignSummary();
        void refreshCurrentPage();
      } else if (payload.type === "annotations-changed") {
        if (payload.pageId === currentPageId) void refreshAnnotations();
      } else if (payload.type === "notes-changed") {
        if (payload.pageId === currentPageId) void refreshNotes();
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
