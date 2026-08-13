import { useEffect, useRef } from "react";
import { annotations as annotationsApi, redo as redoApi, undo as undoApi } from "./api.ts";
import { useApplyAppTheme } from "./app-theme.ts";
import { EmptyState } from "./components/EmptyState.tsx";
import { RightPanel } from "./components/RightPanel.tsx";
import { Sidebar } from "./components/Sidebar.tsx";
import { StatusBar } from "./components/StatusBar.tsx";
import { Toaster } from "./components/Toaster.tsx";
import { TopBar } from "./components/TopBar.tsx";
import { VariantGrid } from "./components/VariantGrid.tsx";
import { useCanvas } from "./store.ts";
import { toastError } from "./toast.ts";
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
  /** Cursor mode at the moment Space was held — restored on keyup. */
  const spaceHeldRef = useRef<"select" | "hand" | "note" | "annotate" | null>(null);

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
        // T → note (free-positioned canvas markdown).
        state.setCursorMode("note");
      } else if (!cmd && !inEditable && (e.key === "y" || e.key === "Y")) {
        // Y → annotate. Tool stays armed until a node is clicked
        // (selection-watcher below catches the click and creates the
        // annotation). Esc cancels.
        state.setCursorMode("annotate");
      } else if (e.key === " " && !inEditable && !spaceHeldRef.current) {
        // Space (hold) → temporary hand tool, like Figma. Restored on keyup.
        e.preventDefault();
        spaceHeldRef.current = state.cursorMode;
        state.setCursorMode("hand");
      } else if (e.key === "Escape") {
        // Esc in any mode bails back to select. Also exits any in-progress
        // edit on a note/annotation (handled within the components).
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
  // and pop back into select mode. The store clears `selection` on entering
  // annotate mode, so the next non-null selection here is always the
  // intended trigger.
  useEffect(() => {
    return useCanvas.subscribe((state) => {
      if (state.cursorMode !== "annotate") return;
      const sel = state.selection;
      if (!sel) return;
      const pageId = state.currentPageId;
      if (!pageId) return;
      // Flip mode immediately so this subscription doesn't re-fire on the
      // selection change made by setCursorMode("select") below.
      state.setCursorMode("select");
      // Restore the selection — clearing in setCursorMode would erase the
      // highlight the user just made.
      state.setSelection(sel);
      const locator = sel.path === "" ? [] : sel.path.split(".").map(Number);
      void (async () => {
        try {
          const r = await annotationsApi.add({
            pageId,
            target: { variantId: sel.variantId, locator },
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
          pages={design.pages}
          snippets={design.snippets}
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
      <Toaster />
    </div>
  );
}
