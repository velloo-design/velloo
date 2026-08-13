import { useEffect } from "react";
import { useCanvas } from "../store.ts";
import { Inspector } from "./Inspector.tsx";
import { ThemePanel } from "./ThemePanel.tsx";

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

  useEffect(() => {
    if (selection) setRightTab("node");
  }, [selection, setRightTab]);

  const handMode = cursorMode === "hand";

  return (
    <aside className="w-80 shrink-0 border-l border-[var(--color-border)] bg-[var(--color-surface)] flex flex-col overflow-hidden">
      <div className="flex border-b border-[var(--color-border)]">
        <TabButton active={rightTab === "node"} onClick={() => setRightTab("node")}>
          Node
        </TabButton>
        <TabButton active={rightTab === "theme"} onClick={() => setRightTab("theme")}>
          Theme
        </TabButton>
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
        <EmptyMessage>Loading theme…</EmptyMessage>
      )}
    </aside>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "flex-1 py-2 text-xs font-medium uppercase tracking-wider transition-colors " +
        (active
          ? "text-[var(--color-fg)] border-b-2 border-[var(--color-accent)]"
          : "text-[var(--color-fg-muted)] border-b-2 border-transparent hover:text-[var(--color-fg)]")
      }
    >
      {children}
    </button>
  );
}

function EmptyMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex-1 grid place-items-center text-xs text-[var(--color-fg-muted)] p-6 text-center">
      {children}
    </div>
  );
}
