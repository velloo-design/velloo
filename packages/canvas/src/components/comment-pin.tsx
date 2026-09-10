import type { Board, CommentThreadView } from "@velloo/schema";
import { Cloud, MessageCircle } from "lucide-react";
import { useMemo } from "react";
import { commentNumbers } from "../comment-order.ts";

/*
 * Comment pins over a board, driven entirely by props — shared, like
 * comment-threads.tsx, by the canvas's CommentPinsLayer and velloo-cloud's
 * share viewer, so a pin lands in the same place and reads the same on both.
 *
 * Render inside the board's world transform, which has to publish its zoom as
 * `--canvas-zoom`: pins counter-scale against it to stay one size.
 */

/** Half the pin's own size (`h-7`), in screen px. */
const PIN_RADIUS = 14;

/**
 * `PIN_RADIUS` in board units. The pin counter-scales out of the board zoom,
 * so its footprint in board space grows as the camera pulls out — which is why
 * the clamp below has to resolve at paint time rather than being a number.
 */
const PIN_INSET = `(${PIN_RADIUS}px / var(--canvas-zoom, 1))`;

/**
 * A board-unit coordinate held a pin's width inside `[low, high]`. CSS `clamp`
 * matches the JS reading when the frame is narrower than a pin: `low` wins.
 */
const clampInsideFrame = (value: number, low: number, high: number): string =>
  `clamp(${low}px + ${PIN_INSET}, ${value}px, ${high}px - ${PIN_INSET})`;

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

export function CommentPins({
  threads,
  frames,
  insets,
  nodeRects,
  activeId,
  onOpen,
  showScope = true,
}: {
  threads: CommentThreadView[];
  frames: Board["frames"];
  insets: FrameInsets;
  nodeRects: NodeRectsByFrame;
  activeId: string | null;
  onOpen(threadId: string): void;
  /** Mark a cloud thread's pin as one. Off on a share link, where all of them are. */
  showScope?: boolean | undefined;
}) {
  const numbers = useMemo(() => commentNumbers(threads), [threads]);
  return (
    <div className="pointer-events-none absolute inset-0" data-velloo-comment-pins>
      {threads.map((thread) => {
        const position = commentPinPosition(thread, frames, insets, nodeRects);
        if (!position) return null;
        const stale = thread.anchorState.status === "stale";
        const active = activeId === thread.id;
        return (
          <button
            key={thread.id}
            type="button"
            data-comment-thread={thread.id}
            data-anchor-state={thread.anchorState.status}
            // `transition-[scale]` rather than `transition-transform`: the
            // hover grow is worth easing, but `transform` carries the
            // counter-scale, and easing that leaves the pins lagging a wheel
            // zoom by the transition's length.
            className={`pointer-events-auto absolute grid h-7 min-w-7 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border px-1.5 text-[11px] font-semibold shadow-md transition-[scale] hover:scale-110 ${
              stale
                ? "border-destructive bg-destructive text-destructive-foreground"
                : active
                  ? "border-primary bg-primary text-primary-foreground ring-2 ring-primary/30"
                  : "border-primary/40 bg-card text-foreground"
            }`}
            // Counter-scaled out of the board zoom (the `--canvas-zoom` recipe
            // frame chrome and the composer use) so a pin is the same size at
            // any camera distance — easy to spot on a board zoomed out to fit.
            // Tailwind v4 puts the utilities above on `translate`/`scale`, so
            // `transform` is free and the -50% centering still holds.
            style={{ ...position, transform: "scale(calc(1 / var(--canvas-zoom, 1)))" }}
            title={stale ? "Comment target changed" : "Open comment thread"}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onOpen(thread.id);
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
        );
      })}
    </div>
  );
}
