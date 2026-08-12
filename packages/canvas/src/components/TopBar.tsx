import { Hand, Minus, Moon, MousePointer2, Plus, Redo2, Sun, Undo2 } from "lucide-react";
import { redo as redoApi, undo as undoApi } from "../api.ts";
import { type AppTheme, type CursorMode, useCanvas } from "../store.ts";
import { toastError } from "../toast.ts";
import { Logo } from "./Logo.tsx";

export function TopBar() {
  const design = useCanvas((s) => s.design);
  const currentPageId = useCanvas((s) => s.currentPageId);
  const theme = useCanvas((s) => s.theme);
  const canvasZoom = useCanvas((s) => s.canvasZoom);
  const setCanvasZoom = useCanvas((s) => s.setCanvasZoom);
  const cursorMode = useCanvas((s) => s.cursorMode);
  const setCursorMode = useCanvas((s) => s.setCursorMode);
  const setPan = useCanvas((s) => s.setPan);
  const history = useCanvas((s) => s.history);
  const refreshHistory = useCanvas((s) => s.refreshHistory);
  const appTheme = useCanvas((s) => s.appTheme);
  const setAppTheme = useCanvas((s) => s.setAppTheme);
  const designMode = useCanvas((s) => s.designMode);
  const setDesignMode = useCanvas((s) => s.setDesignMode);

  const currentPage = design?.pages.find((p) => p.id === currentPageId);
  const isDesignDark = designMode === "dark";
  const hasDarkPalette = Boolean(theme?.colorsDark);

  const toggleDesignDark = () => {
    if (!hasDarkPalette) {
      toastError(
        "This theme has no dark palette. Add `colorsDark` in theme/default.json.",
        "Theme has no dark palette",
      );
      return;
    }
    setDesignMode(isDesignDark ? "light" : "dark");
  };

  const onZoomReset = () => {
    setCanvasZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const onUndo = () => {
    void undoApi()
      .catch((e) => toastError(e, "Undo failed"))
      .finally(() => refreshHistory());
  };
  const onRedo = () => {
    void redoApi()
      .catch((e) => toastError(e, "Redo failed"))
      .finally(() => refreshHistory());
  };

  return (
    <header className="h-11 shrink-0 border-b border-[var(--color-border)] bg-[var(--color-surface)] flex items-center gap-3 px-4 text-sm">
      <div className="flex items-center gap-2 min-w-0">
        <Logo size={22} />
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
            {
              value: "select",
              icon: <MousePointer2 size={14} strokeWidth={2} />,
              title: "Select tool (V)",
            },
            {
              value: "hand",
              icon: <Hand size={14} strokeWidth={2} />,
              title: "Hand tool (H)",
            },
          ]}
          value={cursorMode}
          onChange={(v) => setCursorMode(v as CursorMode)}
        />

        <div className="flex items-center gap-1 ml-2">
          <SmallButton
            title={`Undo (⌘Z)${history.undo > 0 ? ` — ${history.undo} step${history.undo === 1 ? "" : "s"}` : ""}`}
            onClick={onUndo}
            disabled={history.undo === 0}
          >
            <Undo2 size={14} strokeWidth={2} />
          </SmallButton>
          <SmallButton
            title={`Redo (⌘⇧Z)${history.redo > 0 ? ` — ${history.redo} step${history.redo === 1 ? "" : "s"}` : ""}`}
            onClick={onRedo}
            disabled={history.redo === 0}
          >
            <Redo2 size={14} strokeWidth={2} />
          </SmallButton>
        </div>

        <div className="h-5 w-px bg-[var(--color-border)]" />

        <div className="flex items-center gap-1">
          <SmallButton title="Zoom out (−)" onClick={() => setCanvasZoom(canvasZoom - 0.1)}>
            <Minus size={14} strokeWidth={2} />
          </SmallButton>
          <button
            type="button"
            onClick={onZoomReset}
            className="px-2 py-1 text-xs tabular-nums text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] min-w-[3rem] text-center"
            title="Reset zoom (0)"
          >
            {Math.round(canvasZoom * 100)}%
          </button>
          <SmallButton title="Zoom in (+)" onClick={() => setCanvasZoom(canvasZoom + 0.1)}>
            <Plus size={14} strokeWidth={2} />
          </SmallButton>
        </div>

        <div className="h-5 w-px bg-[var(--color-border)] mx-1" />

        <button
          type="button"
          onClick={toggleDesignDark}
          className="rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-xs hover:bg-[var(--color-surface)] flex items-center gap-1"
          title={isDesignDark ? "Design: switch to light preset" : "Design: switch to dark preset"}
        >
          {isDesignDark ? <Sun size={13} /> : <Moon size={13} />}
          <span>Design</span>
        </button>

        <AppThemePicker value={appTheme} onChange={setAppTheme} />
      </div>
    </header>
  );
}

function AppThemePicker({ value, onChange }: { value: AppTheme; onChange: (t: AppTheme) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as AppTheme)}
      title="App theme (Velloo UI). Independent of the design's theme."
      className="rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-xs hover:bg-[var(--color-surface)]"
    >
      <option value="light">App: Light</option>
      <option value="dark">App: Dark</option>
      <option value="system">App: System</option>
    </select>
  );
}

function SmallButton({
  onClick,
  title,
  children,
  disabled,
}: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      disabled={disabled}
      className="h-7 w-7 grid place-items-center rounded border border-[var(--color-border)] bg-[var(--color-bg)] text-xs hover:bg-[var(--color-surface)] disabled:opacity-40 disabled:pointer-events-none"
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
  options: { value: T; icon: React.ReactNode; title: string }[];
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
              "h-7 w-8 grid place-items-center transition-colors " +
              (active
                ? "bg-[var(--color-accent)] text-[var(--color-accent-fg)]"
                : "text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]")
            }
          >
            {opt.icon}
          </button>
        );
      })}
    </div>
  );
}
