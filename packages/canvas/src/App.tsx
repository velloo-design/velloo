import { useEffect, useRef } from "react";
import { redo as redoApi, undo as undoApi } from "./api.ts";
import { useApplyAppTheme } from "./app-theme.ts";
import { EmptyState } from "./components/EmptyState.tsx";
import { RightPanel } from "./components/RightPanel.tsx";
import { Sidebar } from "./components/Sidebar.tsx";
import { StatusBar } from "./components/StatusBar.tsx";
import { TopBar } from "./components/TopBar.tsx";
import { VariantGrid } from "./components/VariantGrid.tsx";
import { useCanvas } from "./store.ts";
import { readUrlState, useUrlState } from "./url-state.ts";
import { connectWs } from "./ws-client.ts";

export function App() {
  const design = useCanvas((s) => s.design);
  const currentPage = useCanvas((s) => s.currentPage);
  const currentPageId = useCanvas((s) => s.currentPageId);
  const loadDesign = useCanvas((s) => s.loadDesign);
  const selectPage = useCanvas((s) => s.selectPage);
  const setSelection = useCanvas((s) => s.setSelection);
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    const seed = readUrlState();
    void (async () => {
      await loadDesign();
      if (seed.pageId) {
        try {
          await selectPage(seed.pageId);
        } catch {
          /* page may have been removed */
        }
      }
      if (seed.selection) setSelection(seed.selection);
    })();
    const stop = connectWs();
    return stop;
  }, [loadDesign, selectPage, setSelection]);

  useUrlState();
  useApplyAppTheme();

  // Global keyboard shortcuts. Canvas zoom uses the un-cmd-prefixed `=` / `-`
  // / `0` keys so the browser's own ⌘=/⌘-/⌘0 still work — getting stuck in
  // browser zoom with no way out is worse than not having a Cmd-prefixed
  // shortcut. V/H toggle cursor mode. ⌘Z / ⌘⇧Z drive undo/redo.
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
        void undoApi().catch(() => undefined);
      } else if (cmd && (e.key === "z" || e.key === "Z") && e.shiftKey) {
        if (inEditable) return;
        e.preventDefault();
        void redoApi().catch(() => undefined);
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
      } else if (e.key === "Escape") {
        // Esc in any mode bails back to select.
        state.setCursorMode("select");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
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
          pages={design.pages}
          currentPageId={currentPageId}
          currentPage={currentPage}
          snapshotVersion={design.snapshotVersion}
        />
        <main className="flex-1 flex flex-col min-w-0">
          {currentPage && currentPageId ? (
            <VariantGrid pageId={currentPageId} page={currentPage} />
          ) : (
            <EmptyState
              title="No page selected"
              hint="Pick a page from the sidebar to see its variants."
            />
          )}
          <StatusBar />
        </main>
        <RightPanel pageId={currentPageId} />
      </div>
    </div>
  );
}
