import { useMemo, useState } from "react";
import { useCanvas } from "../store.ts";
import { CommentPins } from "./comment-pin.tsx";
import { canvasCanActOnFor, DeleteCommentDialog } from "./comment-threads.tsx";

export function CommentPinsLayer() {
  const visible = useCanvas((state) => state.markupVisible);
  const threads = useCanvas((state) => state.commentThreads);
  const activeId = useCanvas((state) => state.activeCommentId);
  const board = useCanvas((state) =>
    state.currentBoardId ? state.boards[state.currentBoardId] : undefined,
  );
  const nodeRects = useCanvas((state) => state.nodeRects);
  const frameInsets = useCanvas((state) => state.frameInsets);
  const setActive = useCanvas((state) => state.setActiveComment);
  const deleteComment = useCanvas((state) => state.deleteComment);
  const setResolved = useCanvas((state) => state.setCommentResolved);
  const signedIn = useCanvas((state) => state.authStatus?.loggedIn === true);
  const actionable = useMemo(() => canvasCanActOnFor(signedIn), [signedIn]);
  // Deleting a thread can't be undone, so the pin asks first, as the panel does.
  const [confirming, setConfirming] = useState<string | null>(null);

  if (!visible || !board) return null;

  const pending = confirming ? (threads.find((t) => t.id === confirming) ?? null) : null;

  return (
    <>
      <CommentPins
        threads={threads}
        frames={board.frames}
        insets={frameInsets}
        nodeRects={nodeRects}
        activeId={activeId}
        onOpen={setActive}
        preview
        onResolve={(threadId) => {
          const thread = threads.find((t) => t.id === threadId);
          if (thread) void setResolved(threadId, thread.status === "open");
        }}
        onDelete={setConfirming}
        actionable={actionable}
      />
      <DeleteCommentDialog
        thread={pending}
        pending={pending ? { kind: "thread", threadId: pending.id } : null}
        onCancel={() => setConfirming(null)}
        onConfirm={() => {
          setConfirming(null);
          if (pending) void deleteComment(pending.id);
        }}
        onResolveInstead={() => {
          setConfirming(null);
          if (pending) void setResolved(pending.id, true);
        }}
      />
    </>
  );
}
