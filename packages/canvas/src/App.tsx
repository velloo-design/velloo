import { Plus, WifiOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { annotations as annotationsApi, redo as redoApi, undo as undoApi } from "./api.ts";
import { useApplyAppTheme } from "./app-theme.ts";
import { ActivityFeed } from "./components/ActivityFeed.tsx";
import { AddFrameDialog } from "./components/AddFrameDialog.tsx";
import { Board } from "./components/Board.tsx";
import { EmptyState } from "./components/EmptyState.tsx";
import { ExportDialog } from "./components/ExportDialog.tsx";
import { LibraryDetail } from "./components/LibraryDetail.tsx";
import { LibraryHome } from "./components/LibraryHome.tsx";
import { PreviewDialog } from "./components/PreviewDialog.tsx";
import { RightPanel } from "./components/RightPanel.tsx";
import { SearchDialog } from "./components/SearchDialog.tsx";
import { Sidebar } from "./components/Sidebar.tsx";
import { SnippetView } from "./components/SnippetView.tsx";
import { StatusBar } from "./components/StatusBar.tsx";
import { TopBar } from "./components/TopBar.tsx";
import { Button } from "./components/ui/button.tsx";
import { Toaster } from "./components/ui/sonner.tsx";
import { useCanvas } from "./store.ts";
import { toastError } from "./toast.ts";
import { readUrlState, useUrlState } from "./url-state.ts";
import { connectWs } from "./ws-client.ts";

export function App() {
  const design = useCanvas((s) => s.design);
  const bootError = useCanvas((s) => s.bootError);
  const view = useCanvas((s) => s.view);
  const libraryItem = useCanvas((s) => s.libraryItem);
  const editingSnippetId = useCanvas((s) => s.editingSnippetId);
  const currentBoardId = useCanvas((s) => s.currentBoardId);
  const currentScreenId = useCanvas((s) => s.currentScreenId);
  const currentBoard = useCanvas((s) =>
    currentBoardId ? (s.boards[currentBoardId] ?? null) : null,
  );
  const loadDesign = useCanvas((s) => s.loadDesign);
  const setSelection = useCanvas((s) => s.setSelection);
  const initialized = useRef(false);
  const spaceHeldRef = useRef<"select" | "hand" | "note" | "annotate" | null>(null);
  const [emptyBoardAddFrame, setEmptyBoardAddFrame] = useState<string | null>(null);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    const seed = readUrlState();
    void (async () => {
      await loadDesign({ boardId: seed.boardId, screenId: seed.screenId });
      if (seed.selection) setSelection(seed.selection);
      if (seed.view === "library") {
        useCanvas.getState().openLibrary(seed.libraryItem);
      } else if (seed.view === "snippet" && seed.snippetId) {
        useCanvas.getState().openSnippetEditor(seed.snippetId);
      }
    })();
    const stop = connectWs();
    return stop;
  }, [loadDesign, setSelection]);

  useUrlState();
  useApplyAppTheme();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inEditable =
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      const cmd = e.metaKey || e.ctrlKey;
      const state = useCanvas.getState();

      // Cmd/Ctrl+K opens search even from inputs — standard palette behavior.
      if (cmd && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        state.setSearchOpen(!state.searchOpen);
      } else if (cmd && (e.key === "z" || e.key === "Z") && !e.shiftKey) {
        if (inEditable) return;
        e.preventDefault();
        void undoApi().catch((e) => toastError(e, "Undo failed"));
      } else if (cmd && (e.key === "z" || e.key === "Z") && e.shiftKey) {
        if (inEditable) return;
        e.preventDefault();
        void redoApi().catch((e) => toastError(e, "Redo failed"));
      } else if (!cmd && !inEditable && (e.key === "=" || e.key === "+")) {
        e.preventDefault();
        state.setCanvasZoom(state.canvasZoom + 0.1);
      } else if (!cmd && !inEditable && e.key === "-") {
        e.preventDefault();
        state.setCanvasZoom(state.canvasZoom - 0.1);
      } else if (!cmd && !inEditable && e.key === "0") {
        e.preventDefault();
        state.setCanvasZoom(1);
        state.setPan({ x: 0, y: 0 });
      } else if (!cmd && !inEditable && (e.key === "v" || e.key === "V")) {
        state.setCursorMode("select");
      } else if (!cmd && !inEditable && (e.key === "h" || e.key === "H")) {
        state.setCursorMode("hand");
      } else if (!cmd && !inEditable && (e.key === "t" || e.key === "T")) {
        state.setCursorMode("note");
      } else if (!cmd && !inEditable && (e.key === "y" || e.key === "Y")) {
        state.setCursorMode("annotate");
      } else if (e.key === " " && !inEditable && !spaceHeldRef.current) {
        e.preventDefault();
        spaceHeldRef.current = state.cursorMode;
        state.setCursorMode("hand");
      } else if (e.key === "Escape") {
        if (state.editingSnippetId) {
          e.preventDefault();
          state.closeSnippetEditor();
          return;
        }
        state.setCursorMode("select");
        state.setEditingMarkupId(null);
      }
    };
    const upHandler = (e: KeyboardEvent) => {
      if (e.key === " " && spaceHeldRef.current) {
        const prior = spaceHeldRef.current;
        spaceHeldRef.current = null;
        useCanvas.getState().setCursorMode(prior);
      }
    };
    window.addEventListener("keydown", handler);
    window.addEventListener("keyup", upHandler);
    return () => {
      window.removeEventListener("keydown", handler);
      window.removeEventListener("keyup", upHandler);
    };
  }, []);

  useEffect(() => {
    return useCanvas.subscribe((state) => {
      if (state.cursorMode !== "annotate") return;
      const sel = state.selection;
      if (!sel) return;
      state.setCursorMode("select");
      state.setSelection(sel);
      const locator = sel.path === "" ? [] : sel.path.split(".").map(Number);
      void (async () => {
        try {
          const r = await annotationsApi.add({
            screenId: sel.screenId,
            target: { locator },
            body: "",
          });
          state.setEditingMarkupId(r.annotation.id);
        } catch (err) {
          toastError(err, "Could not add annotation");
        }
      })();
    });
  }, []);

  if (!design) {
    if (bootError) {
      return (
        <div className="h-full grid place-items-center p-8">
          <div className="max-w-md text-center flex flex-col items-center gap-3">
            <WifiOff className="text-muted-foreground" size={28} />
            <div className="text-base font-medium">Can't reach the velloo daemon</div>
            <div className="text-sm text-muted-foreground">
              The design server isn't answering ({bootError}). Start it with{" "}
              <span className="font-mono">velloo run</span> — the canvas reconnects automatically,
              or retry now.
            </div>
            <Button variant="outline" onClick={() => void useCanvas.getState().loadDesign()}>
              Retry
            </Button>
          </div>
        </div>
      );
    }
    return (
      <div className="h-full grid place-items-center text-sm text-muted-foreground">Loading…</div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <TopBar />
      <DisconnectedBanner />
      <div className="flex-1 flex min-h-0">
        <Sidebar
          boards={design.boards}
          screens={design.screens}
          snippets={design.snippets}
          currentBoardId={currentBoardId}
          currentScreenId={currentScreenId}
          snapshotVersion={design.snapshotVersion}
        />
        <main className="flex-1 flex flex-col min-w-0">
          {view === "snippet" && editingSnippetId ? (
            <SnippetView
              snippetId={editingSnippetId}
              snippetMeta={design.snippets.find((s) => s.id === editingSnippetId) ?? null}
              presets={design.viewportPresets}
            />
          ) : view === "library" ? (
            libraryItem ? (
              <LibraryDetail item={libraryItem} snippets={design.snippets} />
            ) : (
              <LibraryHome snippets={design.snippets} />
            )
          ) : currentBoard && currentBoard.frames.length > 0 ? (
            <Board board={currentBoard} />
          ) : currentBoard ? (
            <EmptyState
              title={`Board "${currentBoard.name}" is empty`}
              hint="Ask your agent to design something here — it places screens on boards through the velloo MCP tools. Or place an existing screen yourself."
              action={
                design.screens.length > 0 ? (
                  <Button variant="outline" onClick={() => setEmptyBoardAddFrame(currentBoard.id)}>
                    <Plus />
                    Add frame
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <EmptyState
              title="No board selected"
              hint="Pick a board from the sidebar to see its frames."
            />
          )}
          <StatusBar />
        </main>
        {view === "boards" ? <RightPanel screenId={currentScreenId} /> : null}
      </div>
      <SearchDialog />
      <ExportDialog />
      <PreviewDialog />
      <AddFrameDialog boardId={emptyBoardAddFrame} onClose={() => setEmptyBoardAddFrame(null)} />
      <ActivityFeed />
      <Toaster />
    </div>
  );
}

/**
 * Unmissable disconnected treatment: shown once the WS has been up
 * and dropped. Loaded boards stay fully navigable — pan, zoom, select,
 * inspect — but every mutation is gated at the API layer until reconnect,
 * and frame iframes freeze their last good render.
 */
function DisconnectedBanner() {
  const wsConnected = useCanvas((s) => s.wsConnected);
  const wsEverConnected = useCanvas((s) => s.wsEverConnected);
  if (wsConnected || !wsEverConnected) return null;
  return (
    <div
      role="status"
      className="shrink-0 flex items-center justify-center gap-2 px-4 py-1.5 text-xs font-medium bg-destructive text-destructive-foreground"
    >
      <WifiOff size={13} />
      Disconnected from the velloo daemon — designs are view-only until it comes back. Reconnecting…
    </div>
  );
}
