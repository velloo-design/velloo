import { Palette, SlidersHorizontal } from "lucide-react";
import { useEffect, useRef } from "react";
import { useCanvas } from "../store.ts";
import { Inspector } from "./Inspector.tsx";
import { Loading } from "./Loading.tsx";
import { CollapsedPaneRail, PaneCollapseButton } from "./PaneRail.tsx";
import { PaneResizer } from "./PaneResizer.tsx";
import { ThemePanel } from "./ThemePanel.tsx";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs.tsx";

interface Props {
  screenId: string | null;
}

export function RightPanel({ screenId }: Props) {
  const rightTab = useCanvas((s) => s.rightTab);
  const setRightTab = useCanvas((s) => s.setRightTab);
  const selection = useCanvas((s) => s.selection);
  const theme = useCanvas((s) => s.theme);
  const presets = useCanvas((s) => s.presets);
  const cursorMode = useCanvas((s) => s.cursorMode);
  const wsConnected = useCanvas((s) => s.wsConnected);
  const collapsed = useCanvas((s) => s.rightPaneCollapsed);
  const setCollapsed = useCanvas((s) => s.setRightPaneCollapsed);
  const width = useCanvas((s) => s.rightPaneWidth);
  const setWidth = useCanvas((s) => s.setRightPaneWidth);
  const paneRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (selection) setRightTab("node");
  }, [selection, setRightTab]);

  const handMode = cursorMode === "hand";

  // Collapsing is an explicit choice, so a selection doesn't reopen the pane
  // — the rail's Node button is the way back, and it lands on the selection.
  if (collapsed) {
    const openOn = (tab: "node" | "theme") => {
      setRightTab(tab);
      setCollapsed(false);
    };
    return (
      <CollapsedPaneRail
        side="right"
        expandLabel="Expand inspector"
        hotkey="]"
        onExpand={() => setCollapsed(false)}
        actions={[
          {
            icon: <SlidersHorizontal />,
            label: "Node",
            active: rightTab === "node",
            // Since a selection no longer forces the pane open, the rail is
            // the only place that says there's something to inspect.
            dot: Boolean(selection),
            onClick: () => openOn("node"),
          },
          {
            icon: <Palette />,
            label: "Theme",
            active: rightTab === "theme",
            onClick: () => openOn("theme"),
          },
        ]}
      />
    );
  }

  return (
    <aside
      ref={paneRef}
      style={{ width }}
      className={
        "relative shrink-0 border-l bg-card flex flex-col overflow-hidden" +
        // Everything in this pane edits the design — dim and disable it
        // wholesale while the daemon is unreachable (the banner says why).
        (wsConnected ? "" : " opacity-50 pointer-events-none select-none")
      }
      aria-disabled={!wsConnected}
    >
      <PaneResizer side="right" width={width} onCommit={setWidth} paneRef={paneRef} />
      <div className="border-b p-2 flex items-center gap-1">
        <PaneCollapseButton
          side="right"
          label="Collapse inspector"
          hotkey="]"
          onCollapse={() => setCollapsed(true)}
        />
        <Tabs
          value={rightTab}
          onValueChange={(v) => setRightTab(v as "node" | "theme")}
          className="min-w-0 flex-1"
        >
          <TabsList className="w-full h-8">
            <TabsTrigger value="node">Node</TabsTrigger>
            <TabsTrigger value="theme">Theme</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      {rightTab === "node" ? (
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
    </aside>
  );
}

function EmptyMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex-1 grid place-items-center text-xs text-muted-foreground p-6 text-center">
      {children}
    </div>
  );
}
