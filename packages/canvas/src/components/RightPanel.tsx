import { useEffect } from "react";
import { useCanvas } from "../store.ts";
import { Inspector } from "./Inspector.tsx";
import { Loading } from "./Loading.tsx";
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

  useEffect(() => {
    if (selection) setRightTab("node");
  }, [selection, setRightTab]);

  const handMode = cursorMode === "hand";

  return (
    <aside
      className={
        "w-80 shrink-0 border-l bg-card flex flex-col overflow-hidden" +
        // Everything in this pane edits the design — dim and disable it
        // wholesale while the daemon is unreachable (the banner says why).
        (wsConnected ? "" : " opacity-50 pointer-events-none select-none")
      }
      aria-disabled={!wsConnected}
    >
      <div className="border-b p-2">
        <Tabs value={rightTab} onValueChange={(v) => setRightTab(v as "node" | "theme")}>
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
