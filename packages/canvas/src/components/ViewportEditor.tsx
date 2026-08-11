import { useEffect, useRef, useState } from "react";

interface Props {
  initial: { w: number; h: number };
  onCommit(next: { w: number; h: number }): void;
  onCancel(): void;
}

/**
 * Tiny inline two-field editor for a viewport. Pops up where the
 * "390 × 844" label used to be. Enter commits, Esc cancels, blur commits.
 */
export function ViewportEditor({ initial, onCommit, onCancel }: Props) {
  const [w, setW] = useState(String(initial.w));
  const [h, setH] = useState(String(initial.h));
  const wRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    wRef.current?.select();
  }, []);

  const commit = () => {
    const nextW = Number.parseInt(w, 10);
    const nextH = Number.parseInt(h, 10);
    if (Number.isFinite(nextW) && Number.isFinite(nextH) && nextW > 0 && nextH > 0) {
      onCommit({ w: nextW, h: nextH });
    } else {
      onCancel();
    }
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  };

  // Stop propagation on each input's mousedown so the parent variant drag
  // handler doesn't see the click and start moving the frame.
  const stopDrag = (e: React.MouseEvent<HTMLInputElement>) => e.stopPropagation();

  return (
    <span className="inline-flex items-center gap-1 tabular-nums">
      <input
        ref={wRef}
        type="number"
        min={1}
        value={w}
        onChange={(e) => setW(e.target.value)}
        onKeyDown={onKey}
        onBlur={commit}
        onMouseDown={stopDrag}
        className="w-14 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-1 py-0 text-xs"
      />
      <span>×</span>
      <input
        type="number"
        min={1}
        value={h}
        onChange={(e) => setH(e.target.value)}
        onKeyDown={onKey}
        onBlur={commit}
        onMouseDown={stopDrag}
        className="w-14 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-1 py-0 text-xs"
      />
    </span>
  );
}
