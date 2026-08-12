import { useCanvas } from "./store.ts";

type ServerEvent = { type: "page-changed"; pageId: string } | { type: "theme-changed" };

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
