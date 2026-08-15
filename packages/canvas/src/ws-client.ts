import { useCanvas } from "./store.ts";

type ServerEvent =
  | { type: "screen-changed"; screenId: string }
  | { type: "board-changed"; boardId: string }
  | { type: "theme-changed" }
  | { type: "snippet-changed"; snippetId: string }
  | { type: "annotations-changed"; screenId: string }
  | { type: "notes-changed"; boardId: string };

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
