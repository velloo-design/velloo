import { useEffect, useRef, useState } from "react";

interface Props {
  initial: { w: number; h: number };
  /** Fires on Enter / blur outside the editor — the "final" commit. */
  onCommit(next: { w: number; h: number }): void;
  /**
   * Fires (debounced) while the user types, so the variant resizes live.
   * Callers should be cheap idempotent — this can fire many times per edit.
   */
  onChange?(next: { w: number; h: number }): void;
  onCancel(): void;
}

const LIVE_DEBOUNCE_MS = 150;

/**
 * Tiny inline two-field editor for a viewport. Pops up where the
 * "390 × 844" label used to be. Enter commits, Esc cancels, blur outside
 * the editor commits — blur to the sibling input does not. While typing,
 * the variant resizes in near real-time via the debounced onChange hook.
 */
export function ViewportEditor({ initial, onCommit, onChange, onCancel }: Props) {
  const [w, setW] = useState(String(initial.w));
  const [h, setH] = useState(String(initial.h));
  const rootRef = useRef<HTMLSpanElement>(null);
  const wRef = useRef<HTMLInputElement>(null);
  const liveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastLive = useRef<{ w: number; h: number }>(initial);

  useEffect(() => {
    wRef.current?.select();
    return () => {
      if (liveTimer.current) clearTimeout(liveTimer.current);
    };
  }, []);

  const parsePair = (): { w: number; h: number } | null => {
    const nw = Number.parseInt(w, 10);
    const nh = Number.parseInt(h, 10);
    if (!Number.isFinite(nw) || !Number.isFinite(nh)) return null;
    if (nw <= 0 || nh <= 0) return null;
    return { w: nw, h: nh };
  };

  const scheduleLive = (next: { w: number; h: number }) => {
    if (!onChange) return;
    if (next.w === lastLive.current.w && next.h === lastLive.current.h) return;
    if (liveTimer.current) clearTimeout(liveTimer.current);
    liveTimer.current = setTimeout(() => {
      lastLive.current = next;
      onChange(next);
    }, LIVE_DEBOUNCE_MS);
  };

  const onChangeW = (value: string) => {
    setW(value);
    const next = Number.parseInt(value, 10);
    if (Number.isFinite(next) && next > 0) {
      scheduleLive({ w: next, h: lastLive.current.h });
    }
  };
  const onChangeH = (value: string) => {
    setH(value);
    const next = Number.parseInt(value, 10);
    if (Number.isFinite(next) && next > 0) {
      scheduleLive({ w: lastLive.current.w, h: next });
    }
  };

  const commit = () => {
    if (liveTimer.current) clearTimeout(liveTimer.current);
    const parsed = parsePair();
    if (parsed) onCommit(parsed);
    else onCancel();
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

  // Only commit on blur when focus actually leaves the editor. relatedTarget
  // is null on some focus paths (Safari, certain mouse flows), so we defer a
  // frame and then check document.activeElement — by then focus has settled
  // on the next element. Width ↔ height swaps keep the editor open.
  const onBlur = () => {
    requestAnimationFrame(() => {
      const root = rootRef.current;
      if (!root) return;
      if (root.contains(document.activeElement)) return;
      commit();
    });
  };

  // Stop propagation on each input's mousedown so the parent variant drag
  // handler doesn't see the click and start moving the frame.
  const stopDrag = (e: React.MouseEvent<HTMLInputElement>) => e.stopPropagation();

  return (
    <span ref={rootRef} className="inline-flex items-center gap-1 tabular-nums">
      <input
        ref={wRef}
        type="number"
        min={1}
        value={w}
        onChange={(e) => onChangeW(e.target.value)}
        onKeyDown={onKey}
        onBlur={onBlur}
        onMouseDown={stopDrag}
        className="w-14 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-1 py-0 text-xs"
      />
      <span>×</span>
      <input
        type="number"
        min={1}
        value={h}
        onChange={(e) => onChangeH(e.target.value)}
        onKeyDown={onKey}
        onBlur={onBlur}
        onMouseDown={stopDrag}
        className="w-14 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-1 py-0 text-xs"
      />
    </span>
  );
}
