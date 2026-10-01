import { useCanvas } from "../store.ts";
import { pushToast } from "../toast.ts";
import { CommentPins } from "./comment-pin.tsx";

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

  if (!visible || !board) return null;

  return (
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
        void deleteComment(threadId);
      }}
    />
  );
}
