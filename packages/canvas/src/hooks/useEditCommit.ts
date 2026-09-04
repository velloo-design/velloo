import { useCallback, useEffect, useRef } from "react";

/**
 * A commit pipeline for edits that arrive faster than they can be written.
 *
 * A discrete edit — typing, picking from a list — debounces: wait until the
 * user stops. A `live` edit throttles instead, because a debounce re-armed by
 * every pointer move never elapses at all, so a scrub showed nothing until the
 * drag paused. Throttling fires on the leading edge and again on the trailing
 * one, which is what makes a drag look like it's doing something.
 *
 * Capture everything the commit needs in `value` — `commit` runs via a
 * latest-ref, so anything it closes over is read at fire time.
 */
export function useEditCommit<T>(
  delayMs: number,
  commit: (value: T) => void,
): (value: T, live?: boolean) => void {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<{ value: T } | null>(null);
  const firedAt = useRef(0);
  const commitRef = useRef(commit);
  commitRef.current = commit;

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const fire = useCallback(() => {
    timer.current = null;
    const held = pending.current;
    pending.current = null;
    if (!held) return;
    firedAt.current = Date.now();
    commitRef.current(held.value);
  }, []);

  return useCallback(
    (value: T, live = false) => {
      pending.current = { value };
      if (!live) {
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(fire, delayMs);
        return;
      }
      // An armed timer already carries the newest value, so let it run out
      // rather than pushing it further away.
      if (timer.current) return;
      timer.current = setTimeout(fire, Math.max(0, delayMs - (Date.now() - firedAt.current)));
    },
    [delayMs, fire],
  );
}
