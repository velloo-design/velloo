import { useEffect, useRef } from "react";
import { annotations as annotationsApi, redo as redoApi, undo as undoApi } from "./api.ts";
import { useApplyAppTheme } from "./app-theme.ts";
import { Board } from "./components/Board.tsx";
import { EmptyState } from "./components/EmptyState.tsx";
import { RightPanel } from "./components/RightPanel.tsx";
import { Sidebar } from "./components/Sidebar.tsx";
import { StatusBar } from "./components/StatusBar.tsx";
import { Toaster } from "./components/Toaster.tsx";
import { TopBar } from "./components/TopBar.tsx";
import { useCanvas } from "./store.ts";
import { toastError } from "./toast.ts";
import { readUrlState, useUrlState } from "./url-state.ts";
import { connectWs } from "./ws-client.ts";

export function App() {
  const design = useCanvas((s) => s.design);
  const board = useCanvas((s) => s.board);
  const currentScreenId = useCanvas((s) => s.currentScreenId);
  const loadDesign = useCanvas((s) => s.loadDesign);
  const selectScreen = useCanvas((s) => s.selectScreen);
  const setSelection = useCanvas((s) => s.setSelection);
  const initialized = useRef(false);
  const spaceHeldRef = useRef<"select" | "hand" | "note" | "annotate" | null>(null);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    const seed = readUrlState();
    void (async () => {
      await loadDesign();
      if (seed.screenId) {
        try {
          await selectScreen(seed.screenId);
        } catch {
          /* screen may have been removed */
        }
      }
      if (seed.selection) setSelection(seed.selection);
    })();
    const stop = connectWs();
    return stop;
  }, [loadDesign, selectScreen, setSelection]);

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

      if (cmd && (e.key === "z" || e.key === "Z") && !e.shiftKey) {
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

  // Annotate mode: when the user clicks a node, anchor an annotation to it
  // and pop back into select mode.
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
    return (
      <div className="h-full grid place-items-center text-sm text-[var(--color-fg-muted)]">
        Loading…
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <TopBar />
      <div className="flex-1 flex min-h-0">
        <Sidebar
          screens={design.screens}
          snippets={design.snippets}
          currentScreenId={currentScreenId}
          snapshotVersion={design.snapshotVersion}
        />
        <main className="flex-1 flex flex-col min-w-0">
          {board && board.frames.length > 0 ? (
            <Board board={board} />
          ) : (
            <EmptyState
              title="No frames on the board"
              hint="Add a screen and place a frame to see it here."
            />
          )}
          <StatusBar />
        </main>
        <RightPanel screenId={currentScreenId} />
      </div>
      <Toaster />
    </div>
  );
}
