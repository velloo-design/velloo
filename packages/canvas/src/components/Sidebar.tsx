import { LayoutDashboard, LibraryBig } from "lucide-react";
import type { BoardMeta, ScreenMeta, SnippetMeta } from "../api.ts";
import { useCanvas } from "../store.ts";
import { BoardsSidebar } from "./BoardsSidebar.tsx";
import { LibrarySidebar } from "./LibrarySidebar.tsx";

interface Props {
  boards: BoardMeta[];
  screens: ScreenMeta[];
  snippets: SnippetMeta[];
  currentBoardId: string | null;
  currentScreenId: string | null;
  snapshotVersion: string;
}

/**
 * Outer sidebar shell. The top tab swaps between "Boards" mode (the
 * classic boards/tree/snippets palette) and "Library" mode (categorized
 * components + snippets to browse and drill into). Footer + outer
 * chrome are shared so the swap feels like a tab change rather than a
 * page nav.
 */
export function Sidebar({
  boards,
  screens,
  snippets,
  currentBoardId,
  currentScreenId,
  snapshotVersion,
}: Props) {
  const view = useCanvas((s) => s.view);
  const setView = useCanvas((s) => s.setView);

  return (
    <aside className="flex h-full w-80 flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="p-2 flex gap-1 border-b border-[var(--color-border)]">
        <button
          type="button"
          onClick={() => setView("boards")}
          className={
            "flex-1 h-8 px-3 rounded-md flex items-center justify-center gap-1.5 text-sm transition-colors " +
            (view === "boards"
              ? "bg-[var(--color-accent)] text-[var(--color-accent-fg)] font-medium"
              : "text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-bg)]")
          }
        >
          <LayoutDashboard size={13} strokeWidth={2} />
          Boards
        </button>
        <button
          type="button"
          onClick={() => setView("library")}
          className={
            "flex-1 h-8 px-3 rounded-md flex items-center justify-center gap-1.5 text-sm transition-colors " +
            (view === "library"
              ? "bg-[var(--color-accent)] text-[var(--color-accent-fg)] font-medium"
              : "text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-bg)]")
          }
        >
          <LibraryBig size={13} strokeWidth={2} />
          Library
        </button>
      </div>

      {view === "boards" ? (
        <BoardsSidebar
          boards={boards}
          screens={screens}
          snippets={snippets}
          currentBoardId={currentBoardId}
          currentScreenId={currentScreenId}
        />
      ) : (
        <LibrarySidebar snippets={snippets} />
      )}

      <footer className="px-4 py-2 text-xs text-[var(--color-fg-muted)] border-t border-[var(--color-border)]">
        shadcn snapshot {snapshotVersion}
      </footer>
    </aside>
  );
}
