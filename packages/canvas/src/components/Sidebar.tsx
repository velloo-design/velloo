import { LayoutDashboard, LibraryBig } from "lucide-react";
import type { BoardMeta, ScreenMeta, SnippetMeta } from "../api.ts";
import { useCanvas } from "../store.ts";
import { BoardsSidebar } from "./BoardsSidebar.tsx";
import { LibrarySidebar } from "./LibrarySidebar.tsx";
import { CollapsedPaneRail, PaneCollapseButton } from "./PaneRail.tsx";
import { PaneShell } from "./PaneShell.tsx";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs.tsx";

interface Props {
  boards: BoardMeta[];
  screens: ScreenMeta[];
  snippets: SnippetMeta[];
  currentBoardId: string | null;
  currentScreenId: string | null;
}

/**
 * Outer sidebar shell. The top tab swaps between "Boards" mode (boards
 * list + tree of the active screen) and "Library" mode (categorized
 * components + snippets to browse and drill into). The outer chrome is
 * shared so the swap feels like a tab change rather than a page nav.
 * Collapses to a rail (`[`) to hand its width to the canvas.
 */
export function Sidebar({ boards, screens, snippets, currentBoardId, currentScreenId }: Props) {
  const view = useCanvas((s) => s.view);
  const setView = useCanvas((s) => s.setView);
  const collapsed = useCanvas((s) => s.leftPaneCollapsed);
  const setCollapsed = useCanvas((s) => s.setLeftPaneCollapsed);
  const width = useCanvas((s) => s.leftPaneWidth);
  const setWidth = useCanvas((s) => s.setLeftPaneWidth);
  const boardPulse = useCanvas((s) => s.boardPulse);

  const openOn = (next: "boards" | "library") => {
    setView(next);
    setCollapsed(false);
  };

  return (
    <PaneShell
      side="left"
      collapsed={collapsed}
      width={width}
      onResize={setWidth}
      rail={
        <CollapsedPaneRail
          side="left"
          expandLabel="Expand sidebar"
          hotkey="["
          onExpand={() => setCollapsed(false)}
          actions={[
            {
              icon: <LayoutDashboard />,
              label: "Boards",
              active: view === "boards",
              // The per-board pulse dots are inside the collapsed list, so
              // without this an agent's work on another board goes unseen.
              dot:
                Object.keys(boardPulse).length > 0
                  ? { title: "an agent edited another board" }
                  : undefined,
              onClick: () => openOn("boards"),
            },
            {
              icon: <LibraryBig />,
              label: "Library",
              active: view === "library",
              onClick: () => openOn("library"),
            },
          ]}
        />
      }
    >
      <div className="flex items-center gap-1 p-2 border-b">
        <Tabs
          value={view}
          onValueChange={(v) => setView(v as "boards" | "library")}
          className="min-w-0 flex-1"
        >
          <TabsList className="w-full h-8">
            <TabsTrigger value="boards" className="text-xs">
              <LayoutDashboard />
              Boards
            </TabsTrigger>
            <TabsTrigger value="library" className="text-xs">
              <LibraryBig />
              Library
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <PaneCollapseButton
          side="left"
          label="Collapse sidebar"
          hotkey="["
          onCollapse={() => setCollapsed(true)}
        />
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
    </PaneShell>
  );
}
