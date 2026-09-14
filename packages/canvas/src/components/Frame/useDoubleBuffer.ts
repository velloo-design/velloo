import { type RefObject, useEffect, useRef, useState } from "react";

export type ScrollPos = { x: number; y: number };

type Slot = 0 | 1;

/**
 * Double-buffered iframes: a src change is a full navigation, and a single
 * iframe blanks white while the new document loads — every edit flickered.
 * Instead the new src loads in a hidden back buffer and the slots swap on
 * its `load`, so the previous render stays painted throughout.
 */
export function useDoubleBuffer(src: string, savedScrollRef: RefObject<ScrollPos | null>) {
  const slotARef = useRef<HTMLIFrameElement>(null);
  const slotBRef = useRef<HTMLIFrameElement>(null);
  const [buffers, setBuffers] = useState<{ srcs: [string | null, string | null]; front: Slot }>(
    () => ({ srcs: [src, null], front: 0 }),
  );
  const buffersRef = useRef(buffers);
  buffersRef.current = buffers;
  const front = buffers.front;

  useEffect(() => {
    setBuffers((b) => {
      const back = (1 - b.front) as Slot;
      if (b.srcs[b.front] === src) {
        // Desired src already visible — drop any stale in-flight back load.
        if (b.srcs[back] === null) return b;
        const srcs: [string | null, string | null] = [...b.srcs];
        srcs[back] = null;
        return { ...b, srcs };
      }
      if (b.srcs[back] === src) return b;
      const srcs: [string | null, string | null] = [...b.srcs];
      srcs[back] = src;
      return { ...b, srcs };
    });
  }, [src]);

  /**
   * A slot's `load`. Returns true when it was the visible slot's first paint
   * (initial mount) — the caller's cue to start the channel handshake; a back
   * buffer's load instead promotes it to the front.
   */
  const settleSlot = (slot: Slot): boolean => {
    const b = buffersRef.current;
    if (slot === b.front) return true;
    if (b.srcs[slot] === null) return false;
    // Same-origin: put the fresh document at the saved scroll offset *before*
    // it becomes visible, so the swap can't flash the top of the screen.
    const saved = savedScrollRef.current;
    const win = (slot === 0 ? slotARef : slotBRef).current?.contentWindow;
    if (saved && win) win.scrollTo(saved.x, saved.y);
    setBuffers(
      slot === 0 ? { srcs: [b.srcs[0], null], front: 0 } : { srcs: [null, b.srcs[1]], front: 1 },
    );
    return false;
  };

  return {
    srcs: buffers.srcs,
    front,
    frontRef: front === 0 ? slotARef : slotBRef,
    slotRefs: [slotARef, slotBRef] as const,
    settleSlot,
  };
}
