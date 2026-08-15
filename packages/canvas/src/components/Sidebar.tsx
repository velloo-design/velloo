import { LayoutDashboard, LibraryBig } from "lucide-react";
import type { BoardMeta, ScreenMeta, SnippetMeta } from "../api.ts";
import { useCanvas } from "../store.ts";
import { BoardsSidebar } from "./BoardsSidebar.tsx";
import { LibrarySidebar } from "./LibrarySidebar.tsx";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs.tsx";

interface Props {
  boards: BoardMeta[];
  screens: ScreenMeta[];
  snippets: SnippetMeta[];
  currentBoardId: string | null;
  currentScreenId: string | null;
  snapshotVersion: string;
}

/**
 * Outer sidebar shell. The top tab swaps between "Boards" mode (boards
 * list + tree of the active screen) and "Library" mode (categorized
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
    <aside className="flex h-full w-80 shrink-0 flex-col border-r bg-card">
      <div className="p-2 border-b">
        <Tabs value={view} onValueChange={(v) => setView(v as "boards" | "library")}>
          <TabsList className="w-full h-8">
            <TabsTrigger value="boards">
              <LayoutDashboard />
              Boards
            </TabsTrigger>
            <TabsTrigger value="library">
              <LibraryBig />
              Library
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {view === "boards" ? (
        <BoardsSidebar
          boards={boards}
          screens={screens}
          currentBoardId={currentBoardId}
          currentScreenId={currentScreenId}
        />
      ) : (
        <LibrarySidebar snippets={snippets} />
      )}

      <footer className="px-4 py-2 text-xs text-muted-foreground border-t">
        shadcn snapshot {snapshotVersion}
      </footer>
    </aside>
  );
}
