import { theme as themeApi } from "../api.ts";
import { type CursorMode, useCanvas } from "../store.ts";

/**
 * Map of preset → its dark counterpart. The light/dark toggle round-trips
 * between these. If the active theme isn't a known light preset, the toggle
 * sends the user to default-dark (and back to default-light).
 */
const DARK_OF: Record<string, string> = {
  "default-light": "default-dark",
  "default-dark": "default-light",
};

export function TopBar() {
  const design = useCanvas((s) => s.design);
  const currentPageId = useCanvas((s) => s.currentPageId);
  const theme = useCanvas((s) => s.theme);
  const canvasZoom = useCanvas((s) => s.canvasZoom);
  const setCanvasZoom = useCanvas((s) => s.setCanvasZoom);
  const cursorMode = useCanvas((s) => s.cursorMode);
  const setCursorMode = useCanvas((s) => s.setCursorMode);
  const setPan = useCanvas((s) => s.setPan);

  const currentPage = design?.pages.find((p) => p.id === currentPageId);
  const isDark = theme?.name === "default-dark";

  const toggleDark = () => {
    const next = DARK_OF[theme?.name ?? ""] ?? (isDark ? "default-light" : "default-dark");
    void themeApi.applyPreset(next).catch(() => undefined);
  };

  const onZoomReset = () => {
    setCanvasZoom(1);
    setPan({ x: 0, y: 0 });
  };

  return (
    <header className="h-10 shrink-0 border-b border-[var(--color-border)] bg-[var(--color-surface)] flex items-center gap-3 px-4 text-sm">
      <div className="flex items-center gap-2 min-w-0">
        <span className="font-semibold tracking-tight">Velloo</span>
        {currentPage ? (
          <>
            <span className="text-[var(--color-fg-muted)]">/</span>
            <span className="text-[var(--color-fg)] truncate">{currentPage.name}</span>
          </>
        ) : null}
      </div>

      <div className="ml-auto flex items-center gap-1.5">
        <SegmentedButton
          options={[
            { value: "select", label: "↗", title: "Select tool (V)" },
            { value: "hand", label: "✋", title: "Hand tool (H)" },
          ]}
          value={cursorMode}
          onChange={(v) => setCursorMode(v as CursorMode)}
        />

        <div className="flex items-center gap-1 ml-2">
          <SmallButton title="Zoom out" onClick={() => setCanvasZoom(canvasZoom - 0.1)}>
            −
          </SmallButton>
          <button
            type="button"
            onClick={onZoomReset}
            className="px-2 py-1 text-xs tabular-nums text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] min-w-[3rem] text-center"
            title="Reset zoom (⌘0)"
          >
            {Math.round(canvasZoom * 100)}%
          </button>
          <SmallButton title="Zoom in" onClick={() => setCanvasZoom(canvasZoom + 0.1)}>
            ＋
          </SmallButton>
        </div>

        <div className="h-5 w-px bg-[var(--color-border)] mx-1" />

        <button
          type="button"
          onClick={toggleDark}
          className="rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-xs hover:bg-[var(--color-surface)]"
          title={isDark ? "Switch to light" : "Switch to dark"}
        >
          {isDark ? "☀︎ Light" : "🌙 Dark"}
        </button>
      </div>
    </header>
  );
}

function SmallButton({
  onClick,
  title,
  children,
}: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="h-7 w-7 grid place-items-center rounded border border-[var(--color-border)] bg-[var(--color-bg)] text-xs hover:bg-[var(--color-surface)]"
    >
      {children}
    </button>
  );
}

function SegmentedButton<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string; title: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex items-center rounded border border-[var(--color-border)] bg-[var(--color-bg)] overflow-hidden">
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            title={opt.title}
            onClick={() => onChange(opt.value)}
            className={
              "h-7 w-8 text-xs grid place-items-center transition-colors " +
              (active
                ? "bg-[var(--color-accent)] text-[var(--color-accent-fg)]"
                : "text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]")
            }
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
