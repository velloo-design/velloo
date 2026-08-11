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
      const { currentPageId, refreshCurrentPage, loadDesign } = useCanvas.getState();
      if (payload.type === "page-changed") {
        if (payload.pageId === currentPageId) {
          void refreshCurrentPage();
        }
        // Other pages: refresh the design summary so the sidebar stays in sync.
        void loadDesign();
      } else if (payload.type === "theme-changed") {
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
