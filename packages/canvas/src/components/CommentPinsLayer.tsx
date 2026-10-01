import { useState } from "react";
import { useCanvas } from "../store.ts";
import { pushToast } from "../toast.ts";
import { CommentPins } from "./comment-pin.tsx";
import { DeleteCommentDialog } from "./comment-threads.tsx";

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
        onDelete={(threadId) => {
          const thread = threads.find((t) => t.id === threadId);
          // Other people have read a cloud thread; the daemon refuses to erase it.
          if (thread?.scope === "shared") {
            pushToast({ message: "A shared thread can't be deleted. Resolve it instead." });
            return;
          }
          setConfirming(threadId);
        }}
      />
      <DeleteCommentDialog
        thread={pending}
        pending={pending ? { kind: "thread", threadId: pending.id } : null}
        onCancel={() => setConfirming(null)}
        onConfirm={() => {
          setConfirming(null);
          if (pending) void deleteComment(pending.id);
        }}
      />
    </>
  );
}
