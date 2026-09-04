import { MessageSquareText, Palette, SquareMousePointer } from "lucide-react";
import { useEffect } from "react";
import { useCanvas } from "../store.ts";
import { CommentsPanel } from "./CommentsPanel.tsx";
import { Inspector } from "./Inspector.tsx";
import { Loading } from "./Loading.tsx";
import { CollapsedPaneRail, PaneCollapseButton } from "./PaneRail.tsx";
import { PaneShell } from "./PaneShell.tsx";
import { ThemePanel } from "./ThemePanel.tsx";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs.tsx";

interface Props {
  screenId: string | null;
}

export function RightPanel({ screenId }: Props) {
  const rightTab = useCanvas((s) => s.rightTab);
  const setRightTab = useCanvas((s) => s.setRightTab);
  const selection = useCanvas((s) => s.selection);
  const selectionIntent = useCanvas((s) => s.selectionIntent);
  const pendingCommentAnchor = useCanvas((s) => s.pendingCommentAnchor);
  const activeCommentId = useCanvas((s) => s.activeCommentId);
  const theme = useCanvas((s) => s.theme);
  const presets = useCanvas((s) => s.presets);
  const cursorMode = useCanvas((s) => s.cursorMode);
  const wsConnected = useCanvas((s) => s.wsConnected);
  const collapsed = useCanvas((s) => s.rightPaneCollapsed);
  const setCollapsed = useCanvas((s) => s.setRightPaneCollapsed);
  const width = useCanvas((s) => s.rightPaneWidth);
  const setWidth = useCanvas((s) => s.setRightPaneWidth);

  useEffect(() => {
    if (
      selection &&
      selectionIntent === "inspect" &&
      !pendingCommentAnchor &&
      !activeCommentId &&
      cursorMode !== "comment"
    ) {
      setRightTab("node");
    }
  }, [selection, selectionIntent, pendingCommentAnchor, activeCommentId, cursorMode, setRightTab]);

  const handMode = cursorMode === "hand";

  // Collapsing is an explicit choice, so a selection doesn't reopen the pane
  // — the rail's Node button is the way back, and it lands on the selection.
  const openOn = (tab: "node" | "theme" | "comments") => {
    setRightTab(tab);
    setCollapsed(false);
  };

  return (
    <PaneShell
      side="right"
      collapsed={collapsed}
      width={width}
      onResize={setWidth}
      // Everything in this pane edits the design — dim and disable it
      // wholesale while the daemon is unreachable (the banner says why).
      contentDisabled={!wsConnected}
      rail={
        <CollapsedPaneRail
          side="right"
          expandLabel="Expand inspector"
          hotkey="]"
          onExpand={() => setCollapsed(false)}
          actions={[
            {
              icon: <SquareMousePointer />,
              label: "Node",
              active: rightTab === "node",
              onClick: () => openOn("node"),
            },
            {
              icon: <MessageSquareText />,
              label: "Comments",
              active: rightTab === "comments",
              onClick: () => openOn("comments"),
            },
            {
              icon: <Palette />,
              label: "Theme",
              active: rightTab === "theme",
              onClick: () => openOn("theme"),
            },
          ]}
        />
      }
    >
      <div className="border-b p-2 flex items-center gap-1">
        <PaneCollapseButton
          side="right"
          label="Collapse inspector"
          hotkey="]"
          onCollapse={() => setCollapsed(true)}
        />
        <Tabs
          value={rightTab}
          onValueChange={(v) => setRightTab(v as "node" | "theme" | "comments")}
          className="min-w-0 flex-1"
        >
          <TabsList className="w-full h-8">
            <TabsTrigger value="node">
              <SquareMousePointer />
              Node
            </TabsTrigger>
            <TabsTrigger value="theme">
              <Palette />
              Theme
            </TabsTrigger>
            <TabsTrigger value="comments">
              <MessageSquareText />
              Comments
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      {rightTab === "comments" ? (
        <CommentsPanel />
      ) : rightTab === "node" ? (
        handMode ? (
          <EmptyMessage>
            Hand tool active. Drag to pan; press V or Esc to return to select.
          </EmptyMessage>
        ) : screenId ? (
          <Inspector />
        ) : (
          <EmptyMessage>No screen selected.</EmptyMessage>
        )
      ) : theme ? (
        <ThemePanel theme={theme} presets={presets} />
      ) : (
        <EmptyMessage>
          <Loading size={24} label="Loading theme…" className="flex-col" />
        </EmptyMessage>
      )}
    </PaneShell>
  );
}

function EmptyMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex-1 grid place-items-center text-xs text-muted-foreground p-6 text-center">
      {children}
    </div>
  );
}
