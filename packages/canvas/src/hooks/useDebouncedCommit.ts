import { useCallback, useEffect, useRef } from "react";

/**
 * One shared debounce timer for a commit pipeline: each call re-arms the
 * timer, so only the last value inside the window fires. A pending commit is
 * dropped (not flushed) on unmount, matching the editors' historical cleanup.
 *
 * Capture everything the commit needs in `value` at call time — `commit`
 * runs via a latest-ref, so anything it closes over is read at fire time.
 */
export function useDebouncedCommit<T>(
  delayMs: number,
  commit: (value: T) => void,
): (value: T) => void {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commitRef = useRef(commit);
  commitRef.current = commit;

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return useCallback(
    (value: T) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => commitRef.current(value), delayMs);
    },
    [delayMs],
  );
}
