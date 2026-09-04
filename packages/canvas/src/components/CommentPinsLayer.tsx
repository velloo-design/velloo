import { Cloud, MessageCircle } from "lucide-react";
import { useMemo } from "react";
import { commentNumbers } from "../comment-order.ts";
import { useCanvas } from "../store.ts";

export function CommentPinsLayer() {
  const visible = useCanvas((state) => state.markupVisible);
  const threads = useCanvas((state) => state.commentThreads);
  const activeId = useCanvas((state) => state.activeCommentId);
  const currentBoardId = useCanvas((state) => state.currentBoardId);
  const board = useCanvas((state) =>
    state.currentBoardId ? state.boards[state.currentBoardId] : undefined,
  );
  const nodeRects = useCanvas((state) => state.nodeRects);
  const frameInsets = useCanvas((state) => state.frameInsets);
  const setActive = useCanvas((state) => state.setActiveComment);
  const numbers = useMemo(() => commentNumbers(threads), [threads]);

  if (!visible || !board || !currentBoardId) return null;

  return (
    <div className="pointer-events-none absolute inset-0" data-velloo-comment-pins>
      {threads.map((thread) => {
        const anchor = thread.anchor;
        if (!anchor) return null;
        let x: number;
        let y: number;
        if (anchor.kind === "board") {
          x = anchor.x;
          y = anchor.y;
        } else {
          const frame = board.frames.find((candidate) => candidate.id === anchor.frameId);
          if (!frame) return null;
          const inset = frameInsets[frame.id] ?? { x: 0, y: 0, chromeH: 0 };
          const path =
            thread.anchorState.status === "attached"
              ? thread.anchorState.resolvedPath.join(".")
              : null;
          const rect = path !== null ? nodeRects[frame.id]?.[path] : undefined;
          const target = rect ?? anchor.bounds;
          x = frame.x + inset.x + target.x + target.w;
          y = frame.y + inset.y + target.y;
        }
        const stale = thread.anchorState.status === "stale";
        const active = activeId === thread.id;
        return (
          <button
            key={thread.id}
            type="button"
            data-comment-thread={thread.id}
            data-anchor-state={thread.anchorState.status}
            className={`pointer-events-auto absolute grid h-7 min-w-7 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border px-1.5 text-[11px] font-semibold shadow-md transition-transform hover:scale-110 ${
              stale
                ? "border-destructive bg-destructive text-destructive-foreground"
                : active
                  ? "border-primary bg-primary text-primary-foreground ring-2 ring-primary/30"
                  : "border-primary/40 bg-card text-foreground"
            }`}
            style={{ left: x, top: y }}
            title={stale ? "Comment target changed" : "Open comment thread"}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              setActive(thread.id);
            }}
          >
            <span className="flex items-center gap-0.5">
              {thread.scope === "shared" ? <Cloud size={10} /> : <MessageCircle size={10} />}
              {numbers.get(thread.id)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
