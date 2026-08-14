import { GripVertical, Link2, X } from "lucide-react";

interface FrameHeaderProps {
  label: string;
  w: number;
  h: number;
  sharedCount: number;
  onPointerDownGrip: (e: React.PointerEvent<HTMLDivElement>) => void;
  onRemove: () => void;
}

/**
 * Top row of a frame: drag grip, label + size readout, shared-screen
 * badge, and the remove button (visible on hover).
 */
export function FrameHeader({
  label,
  w,
  h,
  sharedCount,
  onPointerDownGrip,
  onRemove,
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
        <span className="opacity-50 tabular-nums">
          {w}×{h}
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
