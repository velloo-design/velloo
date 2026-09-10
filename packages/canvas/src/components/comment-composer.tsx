import type { Board, CommentAnchor } from "@velloo/schema";
import { MapPin, X } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { iframeRectToBoard } from "../board-geometry.ts";
import { submitOnModEnter } from "../keys.ts";
import { CommentFailure } from "./comment-threads.tsx";
import { Button } from "./ui/button.tsx";
import { Textarea } from "./ui/textarea.tsx";

/*
 * The draft box for a pinned comment, beside the thing it's about — driven by
 * props alone, and shared, like comment-threads.tsx, by the canvas's
 * PendingCommentComposer and velloo-cloud's share viewer.
 *
 * Render inside the board's world transform, which has to publish its zoom as
 * `--canvas-zoom`: the composer counter-scales against it to stay legible.
 */

/** Screen-space offset from the anchored box to the composer's top-left. */
const PIN_GAP = 14;

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Insets = Record<string, { x: number; y: number } | undefined>;

/**
 * The board-space box the comment is being written *about*: the commented
 * node, or a zero-size point for a pin dropped on empty board.
 *
 * Deliberately the anchor's own click-time bounds rather than the live rect of
 * whatever happens to be selected — those are two different nodes as often as
 * not, and reading the selection put the composer beside the wrong one.
 */
function anchoredBox(anchor: CommentAnchor, frames: Board["frames"], insets: Insets): Box | null {
  if (anchor.kind === "board") return { x: anchor.x, y: anchor.y, w: 0, h: 0 };
  const frame = frames.find((candidate) => candidate.id === anchor.frameId);
  if (!frame) return null;
  return iframeRectToBoard(frame, insets[frame.id] ?? { x: 0, y: 0 }, anchor.bounds);
}

export function PinnedCommentComposer({
  anchor,
  frames,
  insets,
  onCancel,
  onSubmit,
  target,
  blocked,
  onFrame,
}: {
  anchor: CommentAnchor;
  frames: Board["frames"];
  insets: Insets;
  onCancel(): void;
  /**
   * Post the draft. Resolves to why it wasn't posted — the draft stays on
   * screen, and deserves to say why — or null once it is a thread.
   */
  onSubmit(body: string): Promise<string | null>;
  /** Where the thread will live, beside submit — the canvas's Local/Cloud choice. */
  target?: ReactNode;
  /** In place of the draft box, for a viewer who can't post yet — a sign-in, say. */
  blocked?: ReactNode;
  /**
   * Frame the camera on the commented box and the composer beside it. The
   * cleanup it returns runs when the draft closes, to put the camera back.
   */
  onFrame?: ((box: Box, panel: { w: number; h: number; gap: number }) => () => void) | undefined;
}) {
  const [draft, setDraft] = useState("");
  const [failure, setFailure] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;

  // biome-ignore lint/correctness/useExhaustiveDependencies: a different picked anchor starts a fresh draft
  useEffect(() => {
    setDraft("");
    setFailure(null);
  }, [anchor]);

  const box = anchoredBox(anchor, frames, insets);

  /**
   * Frame the pair: the box being commented on, and the composer beside it.
   * The composer counter-scales against the board so it is always legible, so
   * what the camera has to fit is a screen-px panel next to a board-space
   * rect — hence its measured size, read after it rendered at whatever height
   * its content settled on.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a newly picked anchor starts a flight — one restarted mid-typing would be a fight, not a help
  useEffect(() => {
    const element = panelRef.current;
    if (!element || !box) return;
    return onFrameRef.current?.(box, {
      w: element.offsetWidth,
      h: element.offsetHeight,
      gap: PIN_GAP,
    });
  }, [anchor]);

  if (!box) return null;

  const submit = () => {
    if (!draft.trim() || posting) return;
    setFailure(null);
    setPosting(true);
    void onSubmit(draft)
      .then(setFailure)
      .finally(() => setPosting(false));
  };

  return (
    <div
      ref={panelRef}
      // Wide enough for the whole target toggle and the submit button, and
      // counter-scaled out of the board's zoom (the `--canvas-zoom` recipe
      // frame chrome uses) so it reads at 100% however far out the camera is.
      // The translate rides *after* the scale so the gap is screen px too.
      className={`absolute z-30 rounded-lg border bg-card p-3 shadow-xl ${target ? "w-96" : "w-80"}`}
      style={{
        left: box.x + box.w,
        top: box.y,
        transform: `scale(calc(1 / var(--canvas-zoom, 1))) translate(${PIN_GAP}px, ${PIN_GAP}px)`,
        transformOrigin: "top left",
      }}
      data-inline-comment-composer
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="mb-2 flex items-center gap-1.5 text-xs font-medium">
        <MapPin size={13} />
        {anchor.kind === "node" ? "Pinned comment" : "Pinned board location"}
        <button
          type="button"
          className="ml-auto text-muted-foreground hover:text-foreground"
          aria-label="Cancel comment"
          onClick={onCancel}
        >
          <X size={13} />
        </button>
      </div>
      {blocked ?? (
        <>
          <Textarea
            autoFocus
            aria-label="New pinned comment"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="What should change?"
            className="min-h-20 resize-none text-sm"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                onCancel();
                return;
              }
              submitOnModEnter(submit)(event);
            }}
          />
          {failure ? <CommentFailure>{failure}</CommentFailure> : null}
          <div className="mt-2 flex items-end gap-2">
            {target ? <div className="min-w-0 flex-1">{target}</div> : null}
            <Button
              size="sm"
              className="ml-auto"
              disabled={posting || !draft.trim()}
              onClick={submit}
            >
              {posting ? "Posting…" : failure ? "Try again" : "Add comment"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
