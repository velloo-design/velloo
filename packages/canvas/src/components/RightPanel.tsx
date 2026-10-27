import {
  Bot,
  type LucideIcon,
  MessageSquareText,
  Palette,
  PencilRuler,
  SquareMousePointer,
} from "lucide-react";
import { useEffect, useRef } from "react";
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

type DesignTab = "node" | "theme";

const DESIGN_TABS: { value: DesignTab; label: string; Icon: LucideIcon }[] = [
  { value: "node", label: "Node", Icon: SquareMousePointer },
  { value: "theme", label: "Theme", Icon: Palette },
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
  const arrivals = useCanvas((s) => s.commentArrivals.length);
  const collapsed = useCanvas((s) => s.rightPaneCollapsed);
  const setCollapsed = useCanvas((s) => s.setRightPaneCollapsed);
  const width = useCanvas((s) => s.rightPaneWidth);
  const setWidth = useCanvas((s) => s.setRightPaneWidth);
  // The pane is the agent, the design (Node and Theme) or the comments; going
  // back to the design lands on the tab the person last had open there.
  const lastDesignTab = useRef<DesignTab>("node");
  if (rightTab === "node" || rightTab === "theme") lastDesignTab.current = rightTab;
  const mode = rightTab === "node" || rightTab === "theme" ? "design" : rightTab;

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
              icon: <Bot />,
              label: "Agent",
              active: rightTab === "agent",
              dot: arrivals > 0 ? { title: "New comments to hand to the agent" } : undefined,
              onClick: () => openOn("agent"),
            },
            {
              icon: <SquareMousePointer />,
              label: "Node",
              active: rightTab === "node",
              onClick: () => openOn("node"),
            },
            {
              icon: <Palette />,
              label: "Theme",
              active: rightTab === "theme",
              onClick: () => openOn("theme"),
            },
            {
              icon: <MessageSquareText />,
              label: "Comments",
              active: rightTab === "comments",
              onClick: () => openOn("comments"),
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
          value={mode}
          onValueChange={(v) =>
            setRightTab(v === "design" ? lastDesignTab.current : (v as RightTab))
          }
          className="@container min-w-0 flex-1"
        >
          {/* A narrow pane keeps the three names and drops their icons. */}
          <TabsList className="w-full h-8 @max-[15rem]:[&_svg]:hidden">
            <TabsTrigger value="agent" className="min-w-0 flex-auto px-1 text-xs">
              <Bot />
              <span className="truncate">Agent</span>
              {arrivals > 0 && mode !== "agent" ? (
                <span
                  className="size-1.5 shrink-0 rounded-full bg-primary"
                  role="img"
                  aria-label="New comments to hand to the agent"
                />
              ) : null}
            </TabsTrigger>
            <TabsTrigger value="design" className="min-w-0 flex-auto px-1 text-xs">
              <PencilRuler />
              <span className="truncate">Design</span>
            </TabsTrigger>
            <TabsTrigger value="comments" className="min-w-0 flex-auto px-1 text-xs">
              <MessageSquareText />
              <span className="truncate">Comments</span>
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      {mode === "design" ? (
        <Tabs
          value={rightTab}
          onValueChange={(v) => setRightTab(v as DesignTab)}
          className="border-b px-2"
        >
          <TabsList variant="line" className="w-full h-8" aria-label="Design">
            {DESIGN_TABS.map(({ value, label, Icon }) => (
              <TabsTrigger
                key={value}
                value={value}
                className="min-w-0 flex-auto px-1 text-xs"
                aria-label={label}
              >
                <Icon />
                <span className="truncate">{label}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      ) : null}
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
