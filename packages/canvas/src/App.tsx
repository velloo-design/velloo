import { useEffect, useRef } from "react";
import { EmptyState } from "./components/EmptyState.tsx";
import { Inspector } from "./components/Inspector.tsx";
import { Sidebar } from "./components/Sidebar.tsx";
import { StatusBar } from "./components/StatusBar.tsx";
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

  if (!design) {
    return (
      <div className="h-full grid place-items-center text-sm text-[var(--color-fg-muted)]">
        Loading…
      </div>
    );
  }

  return (
    <div className="h-full flex">
      <Sidebar
        pages={design.pages}
        currentPageId={currentPageId}
        currentPage={currentPage}
        snapshotVersion={design.snapshotVersion}
        themeName={design.theme.name}
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
      {currentPageId ? <Inspector pageId={currentPageId} /> : null}
    </div>
  );
}
