import { useCanvas } from "../store.ts";

export function StatusBar() {
  const wsConnected = useCanvas((s) => s.wsConnected);
  const selection = useCanvas((s) => s.selection);
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-1.5 border-t border-[var(--color-border)] bg-[var(--color-surface)] text-xs text-[var(--color-fg-muted)]">
      <div className="flex items-center gap-2">
        <span
          className={`inline-block h-2 w-2 rounded-full ${wsConnected ? "bg-emerald-500" : "bg-zinc-400"}`}
        />
        <span>{wsConnected ? "Live" : "Disconnected"}</span>
      </div>
      <div>
        {selection
          ? `${selection.variantId} · ${selection.path === "" ? "(root)" : selection.path}`
          : "no selection"}
      </div>
    </div>
  );
}
