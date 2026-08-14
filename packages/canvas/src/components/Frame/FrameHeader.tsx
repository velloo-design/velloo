import { GripVertical, Link2, X } from "lucide-react";
import { useEffect, useState } from "react";

interface FrameHeaderProps {
  label: string;
  w: number;
  h: number;
  sharedCount: number;
  onPointerDownGrip: (e: React.PointerEvent<HTMLDivElement>) => void;
  onRemove: () => void;
  /** Commit a new size from the header's inline w/h inputs. */
  onResize: (next: { w?: number; h?: number }) => void;
}

const MIN_SIZE = 120;
const MAX_SIZE = 4096;

function clamp(n: number): number {
  return Math.max(MIN_SIZE, Math.min(MAX_SIZE, Math.round(n)));
}

/**
 * Top row of a frame: drag grip, label + editable size inputs,
 * shared-screen badge, and the remove button (visible on hover).
 *
 * The size readout is a pair of `<input type="number">` so power users
 * can type an exact size or press ↑/↓ to nudge the frame by 1px (or
 * step=10 with Shift). Commits on Enter or blur — typing doesn't
 * roundtrip to the server every keystroke.
 */
export function FrameHeader({
  label,
  w,
  h,
  sharedCount,
  onPointerDownGrip,
  onRemove,
  onResize,
}: FrameHeaderProps) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs text-[var(--color-fg-muted)]">
      <div className="flex items-center gap-1 min-w-0">
        <div
          onPointerDown={onPointerDownGrip}
          className="shrink-0 h-4 w-4 grid place-items-center rounded cursor-grab active:cursor-grabbing text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-surface)]"
          title="Drag to move"
          role="presentation"
        >
          <GripVertical size={12} strokeWidth={2} />
        </div>
        <span className="font-medium truncate">{label}</span>
        <span className="inline-flex items-center gap-0.5 opacity-60 tabular-nums">
          <SizeInput
            value={w}
            ariaLabel="frame width"
            onCommit={(v) => onResize({ w: clamp(v) })}
          />
          <span className="opacity-60">×</span>
          <SizeInput
            value={h}
            ariaLabel="frame height"
            onCommit={(v) => onResize({ h: clamp(v) })}
          />
        </span>
        {sharedCount > 1 ? (
          <span
            className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] bg-[var(--color-accent)]/10 text-[var(--color-accent)]"
            title={`${sharedCount} frames share this screen — edits sync across all of them.`}
          >
            <Link2 size={10} />
            {sharedCount}
          </span>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="opacity-0 group-hover:opacity-100 transition-opacity h-4 w-4 grid place-items-center rounded hover:bg-[var(--color-surface)] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
        title="Remove this frame (the underlying screen stays)"
      >
        <X size={11} />
      </button>
    </div>
  );
}

interface SizeInputProps {
  value: number;
  ariaLabel: string;
  onCommit: (next: number) => void;
}

/**
 * Inline numeric input wired to commit on blur or Enter. Tracks local
 * draft state so typing doesn't fight the prop value mid-edit. Esc
 * cancels back to the current frame size; ↑/↓ uses the browser's
 * step=1 default (Shift+↑/↓ steps by 10 via the size attribute).
 */
function SizeInput({ value, ariaLabel, onCommit }: SizeInputProps) {
  const [draft, setDraft] = useState<string>(String(value));
  // Keep draft in sync when the frame is resized via drag-handle.
  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commit = () => {
    const next = Number(draft);
    if (!Number.isFinite(next)) {
      setDraft(String(value));
      return;
    }
    if (next === value) return;
    onCommit(next);
  };

  return (
    <input
      type="number"
      value={draft}
      min={MIN_SIZE}
      max={MAX_SIZE}
      step={1}
      aria-label={ariaLabel}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          (e.currentTarget as HTMLInputElement).blur();
        }
        if (e.key === "Escape") {
          setDraft(String(value));
          (e.currentTarget as HTMLInputElement).blur();
        }
      }}
      onPointerDown={(e) => e.stopPropagation()}
      className="w-10 bg-transparent text-right tabular-nums outline-none hover:bg-[var(--color-surface)] focus:bg-[var(--color-surface)] rounded-sm px-0.5 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
    />
  );
}
