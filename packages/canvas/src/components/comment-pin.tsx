import type { Board, CommentThreadView } from "@velloo/schema";
import { Cloud, MessageCircle, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { commentNumbers } from "../comment-order.ts";
import { clampInsideFrame, pileKey, pileTranslate } from "../pin-geometry.ts";
import { ThreadPreview } from "./comment-threads.tsx";

/*
 * Comment pins over a board, driven entirely by props — shared, like
 * comment-threads.tsx, by the canvas's CommentPinsLayer and velloo-cloud's
 * share viewer, so a pin lands in the same place and reads the same on both.
 *
 * Render inside the board's world transform, which has to publish its zoom as
 * `--canvas-zoom`: pins counter-scale against it to stay one size.
 */

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Each frame's iframe offset from the frame origin — the header row above it. */
export type FrameInsets = Record<string, { x: number; y: number } | undefined>;
/** Live node rects per frame, keyed by dotted node path, in iframe px. */
export type NodeRectsByFrame = Record<string, Record<string, Box> | undefined>;

/**
 * Where a thread's pin sits in board space, as CSS lengths — or null when it
 * has nowhere to sit: a board-wide thread, or a node whose frame is gone.
 */
export function commentPinPosition(
  thread: CommentThreadView,
  frames: Board["frames"],
  insets: FrameInsets,
  nodeRects: NodeRectsByFrame,
): { left: string; top: string } | null {
  const anchor = thread.anchor;
  if (!anchor) return null;
  if (anchor.kind === "board") return { left: `${anchor.x}px`, top: `${anchor.y}px` };
  const frame = frames.find((candidate) => candidate.id === anchor.frameId);
  if (!frame) return null;
  const inset = insets[frame.id] ?? { x: 0, y: 0 };
  const path =
    thread.anchorState.status === "attached" ? thread.anchorState.resolvedPath.join(".") : null;
  const rect = path !== null ? nodeRects[frame.id]?.[path] : undefined;
  const target = rect ?? anchor.bounds;
  // The pin straddles the node's top-right corner, but it has to stay inside
  // the frame: a node flush with the top edge would otherwise put half a pin
  // up in the frame's header, on top of its ⋯ menu.
  const left = frame.x + inset.x;
  const top = frame.y + inset.y;
  return {
    left: clampInsideFrame(left + target.x + target.w, left, left + frame.w),
    top: clampInsideFrame(top + target.y, top, top + frame.h),
  };
}

/** How long a hovered card waits after the pointer leaves, so it can be reached. */
const CLOSE_DELAY_MS = 160;

export function CommentPins({
  threads,
  frames,
  insets,
  nodeRects,
  activeId,
  onOpen,
  onDelete,
  preview = false,
  showScope = true,
}: {
  threads: CommentThreadView[];
  frames: Board["frames"];
  insets: FrameInsets;
  nodeRects: NodeRectsByFrame;
  activeId: string | null;
  onOpen(threadId: string): void;
  /** Delete or Backspace on a focused pin. Absent where nobody may delete. */
  onDelete?: ((threadId: string) => void) | undefined;
  /**
   * Read a thread at the pin: hovering shows it, clicking keeps it shown, and
   * the card's "Open thread" is what reaches `onOpen`. Off, a click opens.
   */
  preview?: boolean | undefined;
  /** Mark a cloud thread's pin as one. Off on a share link, where all of them are. */
  showScope?: boolean | undefined;
}) {
  const numbers = useMemo(() => commentNumbers(threads), [threads]);
  // Threads on the same spot pile up, in order, rather than hiding each other.
  const pileSize = new Map<string, number>();
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    [],
  );

  // Delete or Backspace deletes the comment under the pointer, as it does a
  // focused pin — unless someone is typing.
  useEffect(() => {
    if (!preview || !onDelete || !hoveredId) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable='true']")) return;
      event.preventDefault();
      onDelete(hoveredId);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [preview, onDelete, hoveredId]);

  const hover = (id: string) => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setHoveredId(id);
  };
  const unhover = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setHoveredId(null), CLOSE_DELAY_MS);
  };

  return (
    <div className="pointer-events-none absolute inset-0" data-velloo-comment-pins>
      {threads.map((thread) => {
        const position = commentPinPosition(thread, frames, insets, nodeRects);
        if (!position) return null;
        const key = pileKey(position);
        const index = pileSize.get(key) ?? 0;
        pileSize.set(key, index + 1);
        const stale = thread.anchorState.status === "stale";
        const active = activeId === thread.id || pinnedId === thread.id;
        const revealed = preview && (pinnedId === thread.id || hoveredId === thread.id);
        return (
          <div key={thread.id}>
            <button
              type="button"
              data-comment-thread={thread.id}
              data-anchor-state={thread.anchorState.status}
              aria-expanded={preview ? revealed : undefined}
              // `transition-[scale]` rather than `transition-transform`: the
              // hover grow is worth easing, but `transform` carries the
              // counter-scale, and easing that leaves the pins lagging a wheel
              // zoom by the transition's length.
              className={`pointer-events-auto absolute grid h-7 min-w-7 place-items-center hover:z-10 rounded-full border px-1.5 text-[11px] font-semibold shadow-md transition-[scale] hover:scale-110 ${
                stale
                  ? "border-destructive bg-destructive text-destructive-foreground"
                  : active
                    ? "border-primary bg-primary text-primary-foreground ring-2 ring-primary/30"
                    : "border-primary/40 bg-card text-foreground"
              }`}
              // Counter-scaled out of the board zoom (the `--canvas-zoom` recipe
              // frame chrome and the composer use) so a pin is the same size at
              // any camera distance — easy to spot on a board zoomed out to fit.
              // `translate` centres the pin on its spot and fans a pile out
              // leftward; `transform` is free for the counter-scale.
              style={{
                ...position,
                translate: pileTranslate(index),
                transform: "scale(calc(1 / var(--canvas-zoom, 1)))",
              }}
              title={preview ? undefined : stale ? "Comment target changed" : "Open comment thread"}
              onPointerDown={(event) => event.stopPropagation()}
              onMouseEnter={preview ? () => hover(thread.id) : undefined}
              onMouseLeave={preview ? unhover : undefined}
              onClick={(event) => {
                event.stopPropagation();
                if (preview) setPinnedId((id) => (id === thread.id ? null : thread.id));
                else onOpen(thread.id);
              }}
              onKeyDown={(event) => {
                if ((event.key === "Delete" || event.key === "Backspace") && onDelete) {
                  event.preventDefault();
                  event.stopPropagation();
                  onDelete(thread.id);
                } else if (event.key === "Escape" && pinnedId === thread.id) {
                  event.preventDefault();
                  event.stopPropagation();
                  setPinnedId(null);
                }
              }}
            >
              <span className="flex items-center gap-0.5">
                {showScope && thread.scope === "shared" ? (
                  <Cloud size={10} />
                ) : (
                  <MessageCircle size={10} />
                )}
                {numbers.get(thread.id)}
              </span>
            </button>
            {revealed ? (
              // biome-ignore lint/a11y/noStaticElementInteractions: hovering the card keeps it open; its controls are buttons
              <div
                className="pointer-events-auto absolute z-20"
                style={{
                  ...position,
                  transform: "scale(calc(1 / var(--canvas-zoom, 1)))",
                  transformOrigin: "top left",
                }}
                onMouseEnter={() => hover(thread.id)}
                onMouseLeave={unhover}
                onPointerDown={(event) => event.stopPropagation()}
              >
                <div className="relative ml-4 mt-4 w-64 rounded-lg border border-border bg-popover p-3 shadow-lg">
                  {onDelete ? (
                    <button
                      type="button"
                      aria-label="Delete comment"
                      title="Delete comment"
                      data-comment-trash
                      className="absolute right-2 top-2 flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-destructive"
                      onClick={(event) => {
                        event.stopPropagation();
                        onDelete(thread.id);
                      }}
                    >
                      <Trash2 size={13} />
                    </button>
                  ) : null}
                  <ThreadPreview thread={thread} onOpen={() => onOpen(thread.id)} />
                  {stale ? (
                    <p className="mt-2 text-xs text-destructive">Its target has changed.</p>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
