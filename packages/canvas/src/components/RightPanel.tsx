import { Bot, type LucideIcon, MessageSquareText, Palette, SquareMousePointer } from "lucide-react";
import { useEffect } from "react";
import type { RightTab } from "../store/types.ts";
import { useCanvas } from "../store.ts";
import { AgentPanel } from "./Agent/AgentPanel.tsx";
import { CommentsPanel } from "./CommentsPanel.tsx";
import { Inspector } from "./Inspector.tsx";
import { Loading } from "./Loading.tsx";
import { CollapsedPaneRail, PaneCollapseButton } from "./PaneRail.tsx";
import { PaneShell } from "./PaneShell.tsx";
import { ThemePanel } from "./ThemePanel.tsx";
import { Empty, EmptyDescription } from "./ui/empty.tsx";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs.tsx";

interface Props {
  screenId: string | null;
}

const TABS: { value: RightTab; label: string; Icon: LucideIcon }[] = [
  { value: "node", label: "Node", Icon: SquareMousePointer },
  { value: "theme", label: "Theme", Icon: Palette },
  { value: "comments", label: "Comments", Icon: MessageSquareText },
  { value: "agent", label: "Agent", Icon: Bot },
];

export function RightPanel({ screenId }: Props) {
  const rightTab = useCanvas((s) => s.rightTab);
  const setRightTab = useCanvas((s) => s.setRightTab);
  const selection = useCanvas((s) => s.selection);
  const selectionIntent = useCanvas((s) => s.selectionIntent);
  const pendingCommentAnchor = useCanvas((s) => s.pendingCommentAnchor);
  const activeCommentId = useCanvas((s) => s.activeCommentId);
  const theme = useCanvas((s) => s.theme);
  const cursorMode = useCanvas((s) => s.cursorMode);
  const wsConnected = useCanvas((s) => s.wsConnected);
  const collapsed = useCanvas((s) => s.rightPaneCollapsed);
  const setCollapsed = useCanvas((s) => s.setRightPaneCollapsed);
  const width = useCanvas((s) => s.rightPaneWidth);
  const setWidth = useCanvas((s) => s.setRightPaneWidth);

  // Selecting on the canvas opens the inspector — except from the Agent tab,
  // where selecting is how the person picks what to attach.
  useEffect(() => {
    if (
      useCanvas.getState().rightTab !== "agent" &&
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
  const openOn = (tab: RightTab) => {
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
            {
              icon: <Bot />,
              label: "Agent",
              active: rightTab === "agent",
              onClick: () => openOn("agent"),
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
          onValueChange={(v) => setRightTab(v as RightTab)}
          className="@container min-w-0 flex-1"
        >
          <TabsList className="w-full h-8">
            {TABS.map(({ value, label, Icon }) => (
              <TabsTrigger
                key={value}
                value={value}
                className="min-w-0 flex-auto px-1 text-xs"
                aria-label={label}
              >
                {/* Four labels don't fit a narrow pane: the others fold to icons, the open one keeps its name. */}
                <Icon className={rightTab === value ? "hidden" : "hidden @max-[14rem]:block"} />
                <span className={rightTab === value ? "truncate" : "truncate @max-[14rem]:hidden"}>
                  {label}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
      {rightTab === "agent" ? (
        <AgentPanel />
      ) : rightTab === "comments" ? (
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
        <ThemePanel theme={theme} />
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
    <Empty className="flex-1 p-6">
      <EmptyDescription className="text-xs">{children}</EmptyDescription>
    </Empty>
  );
}
