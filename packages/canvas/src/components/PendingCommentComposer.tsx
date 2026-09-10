import type { Board, CommentAnchor } from "@velloo/schema";
import { MapPin, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { CommentScope } from "../api.ts";
import { iframeRectToBoard } from "../board-geometry.ts";
import { submitOnModEnter } from "../keys.ts";
import { useCanvas } from "../store.ts";
import { CommentTargetToggle } from "./CommentScopeControls.tsx";
import { Button } from "./ui/button.tsx";
import { Textarea } from "./ui/textarea.tsx";

/** Screen-space offset from the anchored box to the composer's top-left. */
const PIN_GAP = 14;

type Insets = Record<string, { x: number; y: number }>;

/**
 * The board-space box the comment is being written *about*: the commented
 * node, or a zero-size point for a pin dropped on empty board.
 *
 * Deliberately the anchor's own click-time bounds rather than the live rect of
 * whatever happens to be selected — those are two different nodes as often as
 * not, and reading the selection put the composer beside the wrong one.
 */
function anchoredBox(anchor: CommentAnchor, board: Board, insets: Insets) {
  if (anchor.kind === "board") return { x: anchor.x, y: anchor.y, w: 0, h: 0 };
  const frame = board.frames.find((candidate) => candidate.id === anchor.frameId);
  if (!frame) return null;
  return iframeRectToBoard(frame, insets[frame.id] ?? { x: 0, y: 0 }, anchor.bounds);
}

export function PendingCommentComposer() {
  const anchor = useCanvas((state) => state.pendingCommentAnchor);
  const board = useCanvas((state) =>
    state.currentBoardId ? state.boards[state.currentBoardId] : undefined,
  );
  const frameInsets = useCanvas((state) => state.frameInsets);
  const cloud = useCanvas((state) => state.cloudComments);
  const clear = useCanvas((state) => state.clearPendingComment);
  const create = useCanvas((state) => state.createPendingComment);
  const zoomForCommentDraft = useCanvas((state) => state.zoomForCommentDraft);
  const restoreView = useCanvas((state) => state.restoreViewAfterMarkupEdit);
  const [draft, setDraft] = useState("");
  const [scope, setScope] = useState<CommentScope>("local");
  const [failure, setFailure] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a different picked anchor starts a fresh draft
  useEffect(() => {
    setDraft("");
    setFailure(null);
  }, [anchor]);

  const box = anchor && board ? anchoredBox(anchor, board, frameInsets) : null;

  /**
   * Frame the pair: the box being commented on, and the composer beside it.
   * The composer counter-scales against the board so it is always legible, so
   * what the camera has to fit is a screen-px panel next to a board-space
   * rect — hence its measured size, read after it rendered at whatever height
   * its content settled on.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a newly picked anchor starts a flight — one restarted mid-typing would be a fight, not a help
  useEffect(() => {
    const element = boxRef.current;
    if (!element || !box) return;
    zoomForCommentDraft(box, {
      w: element.offsetWidth,
      h: element.offsetHeight,
      gap: PIN_GAP,
    });
    return restoreView;
  }, [anchor, zoomForCommentDraft, restoreView]);

  if (!anchor || !board || !box) return null;

  const submit = () => {
    if (!draft.trim()) return;
    setFailure(null);
    void create(draft, scope).then(setFailure);
  };

  return (
    <div
      ref={boxRef}
      // Wide enough for the whole target toggle and the submit button, and
      // counter-scaled out of the board's zoom (the `--canvas-zoom` recipe
      // frame chrome uses) so it reads at 100% however far out the camera is.
      // The translate rides *after* the scale so the gap is screen px too.
      className="absolute z-30 w-96 rounded-lg border bg-card p-3 shadow-xl"
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
          onClick={clear}
        >
          <X size={13} />
        </button>
      </div>
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
            clear();
            return;
          }
          submitOnModEnter(submit)(event);
        }}
      />
      {failure ? (
        <p
          className="mt-2 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-[11px] text-destructive"
          data-comment-failure
          role="alert"
        >
          {failure}
        </p>
      ) : null}
      <div className="mt-2 flex items-end gap-2">
        <CommentTargetToggle
          scope={scope}
          onChange={setScope}
          cloud={cloud}
          className="min-w-0 flex-1"
        />
        <Button size="sm" className="ml-auto" disabled={!draft.trim()} onClick={submit}>
          {failure ? "Try again" : "Add comment"}
        </Button>
      </div>
    </div>
  );
}
