import { useCanvas } from "../store.ts";
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

  if (!visible || !board) return null;

  return (
    <CommentPins
      threads={threads}
      frames={board.frames}
      insets={frameInsets}
      nodeRects={nodeRects}
      activeId={activeId}
      onOpen={setActive}
    />
  );
}
