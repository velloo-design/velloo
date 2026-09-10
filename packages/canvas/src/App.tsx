import { Plus, WifiOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { mutate, onSignInRequired, redo as redoApi, undo as undoApi } from "./api.ts";
import { useApplyAppTheme } from "./app-theme.ts";
import { formatBrowserTitle } from "./browser-title.ts";
import { ActivityFeed } from "./components/ActivityFeed.tsx";
import { AddFrameDialog } from "./components/AddFrameDialog.tsx";
import { Board } from "./components/Board.tsx";
import { EmptyState } from "./components/EmptyState.tsx";
import { ExportDialog } from "./components/ExportDialog.tsx";
import { LibraryDetail } from "./components/LibraryDetail.tsx";
import { LibraryHome } from "./components/LibraryHome.tsx";
import { Loading } from "./components/Loading.tsx";
import { PreviewDialog } from "./components/PreviewDialog.tsx";
import { PublishDialog } from "./components/PublishDialog.tsx";
import { PublishedBoardsDialog } from "./components/PublishedBoardsDialog.tsx";
import { RightPanel } from "./components/RightPanel.tsx";
import { SearchDialog } from "./components/SearchDialog.tsx";
import { SettingsDialog } from "./components/Settings/SettingsDialog.tsx";
import { Sidebar } from "./components/Sidebar.tsx";
import { SignInDialog } from "./components/SignInDialog.tsx";
import { SnippetView } from "./components/SnippetView.tsx";
import { TopBar } from "./components/TopBar.tsx";
import { Button } from "./components/ui/button.tsx";
import { Toaster } from "./components/ui/sonner.tsx";
import { useCanvas } from "./store.ts";
import { toastError } from "./toast.ts";
import { startUpdateWatch } from "./updates.ts";
import { readUrlState, useUrlState } from "./url-state.ts";
import { connectWs } from "./ws-client.ts";

/**
 * Keeps the canvas honest about its velloo-cloud account.
 *
 * Two halves of the same problem. The gate lets the API layer ask for a
 * sign-in from wherever a call failed on the credential, without importing the
 * store. The poll is what makes a revoked token show up on its own: the daemon
 * caches the cloud's verdict for a minute, so asking less often than that would
 * only delay the news, and asking more often would not learn anything new.
 */
const AUTH_POLL_MS = 60_000;

function useCloudSession(): void {
  useEffect(() => {
    const stop = onSignInRequired((prompt) => useCanvas.getState().openSignIn(prompt));
    const refresh = () => void useCanvas.getState().refreshAuth();
    refresh();
    const timer = setInterval(refresh, AUTH_POLL_MS);
    // A backgrounded tab stops firing timers reliably; the moment it comes back
    // is exactly when the user is about to act on stale account state.
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stop();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
}

/**
 * The side panes against the window they have to live in: past the width that
 * holds both plus a canvas, they take turns (see `syncPaneLayout`). Only the
 * window drives this — a pane's own resize drag deliberately doesn't, or
 * widening one would fold the pane under the cursor.
 */
function usePaneLayout(): void {
  useEffect(() => {
    const sync = () => useCanvas.getState().syncPaneLayout(window.innerWidth);
    sync();
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
  }, []);
}

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
  const spaceHeldRef = useRef<"select" | "hand" | "note" | "comment" | null>(null);
  const [emptyBoardAddFrame, setEmptyBoardAddFrame] = useState<string | null>(null);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    const seed = readUrlState();
    // Enter the destination view *before* the boot fetches, not after them.
    // `loadDesign` publishes the design summary on its first round trip and
    // keeps going for several more (board, screen, theme, history), so a view
    // flipped at the end leaves the board mounted — frame iframes and all —
    // for the whole tail of a boot the deep link never asked for a board in.
    if (seed.view === "library") {
      useCanvas.getState().openLibrary(seed.libraryItem);
    } else if (seed.view === "snippet" && seed.snippetId) {
      useCanvas.getState().openSnippetEditor(seed.snippetId);
    }
    void (async () => {
      await loadDesign({ boardId: seed.boardId, screenId: seed.screenId });
      // Only boards carry a node selection in the URL, and openSnippetEditor
      // deliberately clears one — don't hand it back.
      if (seed.view === "boards" && seed.selection) setSelection(seed.selection);
    })();
    const stop = connectWs();
    return stop;
  }, [loadDesign, setSelection]);

  useUrlState();
  useApplyAppTheme();
  useCloudSession();
  usePaneLayout();
  // A new velloo announces itself once, then sits as a dot on the account
  // menu — the daemon does the actual checking on its own schedule.
  useEffect(startUpdateWatch, []);

  // Browser tab: `<repo> · <board> - velloo` (middle-dot between repo/board).
  useEffect(() => {
    document.title = formatBrowserTitle(design?.folderName, currentBoard?.name);
  }, [design?.folderName, currentBoard?.name]);

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
        state.zoomAtViewportCenter({ factor: 1.1 });
      } else if (!cmd && !inEditable && e.key === "-") {
        e.preventDefault();
        state.zoomAtViewportCenter({ factor: 1 / 1.1 });
      } else if (!cmd && !inEditable && e.key === "0") {
        e.preventDefault();
        state.zoomAtViewportCenter({ zoom: 1 });
      } else if (!cmd && !inEditable && e.key === "[") {
        e.preventDefault();
        state.setLeftPaneCollapsed(!state.leftPaneCollapsed);
      } else if (!cmd && !inEditable && e.key === "]") {
        e.preventDefault();
        state.setRightPaneCollapsed(!state.rightPaneCollapsed);
      } else if (!cmd && !inEditable && (e.key === "v" || e.key === "V")) {
        state.setCursorMode("select");
      } else if (!cmd && !inEditable && (e.key === "h" || e.key === "H")) {
        state.setCursorMode("hand");
      } else if (!cmd && !inEditable && (e.key === "t" || e.key === "T")) {
        state.setCursorMode("note");
      } else if (!cmd && !inEditable && (e.key === "c" || e.key === "C")) {
        state.enterCommentMode();
      } else if (e.key === " " && !inEditable && !spaceHeldRef.current) {
        e.preventDefault();
        spaceHeldRef.current = state.cursorMode;
        state.setCursorMode("hand");
      } else if (e.key === "Escape") {
        if (state.snippetFocus) {
          e.preventDefault();
          state.setSnippetFocus(null);
          return;
        }
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
        const s = useCanvas.getState();
        s.setCursorMode(prior);
      }
    };
    window.addEventListener("keydown", handler);
    window.addEventListener("keyup", upHandler);
    return () => {
      window.removeEventListener("keydown", handler);
      window.removeEventListener("keyup", upHandler);
    };
  }, []);

  // Body mode classes drive workspace-wide cursors (and hand/note iframe
  // pointer-events) via styles.css — including over chrome outside frames.
  useEffect(() => {
    const modes = ["hand", "note", "comment"] as const;
    const sync = (mode: string) => {
      for (const m of modes) {
        document.body.classList.toggle(`velloo-${m}`, mode === m);
      }
    };
    sync(useCanvas.getState().cursorMode);
    const unsub = useCanvas.subscribe((state, prev) => {
      if (state.cursorMode === prev.cursorMode) return;
      sync(state.cursorMode);
    });
    return () => {
      unsub();
      for (const m of modes) document.body.classList.remove(`velloo-${m}`);
    };
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
      <div className="h-full grid place-items-center">
        <Loading size={44} />
      </div>
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
              title={design.boards.length === 0 ? "No boards yet" : "No board selected"}
              hint={
                design.boards.length === 0
                  ? "Create a board to start designing — or ask your agent over MCP to set up the folder."
                  : "Pick a board from the sidebar to see its frames."
              }
              action={
                design.boards.length === 0 ? (
                  <Button
                    variant="outline"
                    onClick={() => {
                      void (async () => {
                        try {
                          const r = await mutate.addBoard({ name: "Main" });
                          await useCanvas.getState().selectBoard(r.boardId);
                        } catch (err) {
                          toastError(err, "Could not create board");
                        }
                      })();
                    }}
                  >
                    <Plus />
                    New board
                  </Button>
                ) : undefined
              }
            />
          )}
        </main>
        {view === "boards" ? <RightPanel screenId={currentScreenId} /> : null}
      </div>
      <SearchDialog />
      <ExportDialog />
      <PreviewDialog />
      <SettingsDialog />
      <AddFrameDialog boardId={emptyBoardAddFrame} onClose={() => setEmptyBoardAddFrame(null)} />
      <SignInDialog />
      <PublishDialog />
      <PublishedBoardsDialog />
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
