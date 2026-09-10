import { useState } from "react";
import type { CommentScope } from "../api.ts";
import { useCanvas } from "../store.ts";
import { CommentTargetToggle } from "./CommentScopeControls.tsx";
import { PinnedCommentComposer } from "./comment-composer.tsx";

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
  // Outlives any one draft: whoever picked Cloud for the last pin most likely
  // wants the next one there too.
  const [scope, setScope] = useState<CommentScope>("local");

  if (!anchor || !board) return null;

  return (
    <PinnedCommentComposer
      anchor={anchor}
      frames={board.frames}
      insets={frameInsets}
      onCancel={clear}
      onSubmit={(body) => create(body, scope)}
      target={<CommentTargetToggle scope={scope} onChange={setScope} cloud={cloud} />}
      onFrame={(box, panel) => {
        zoomForCommentDraft(box, panel);
        return restoreView;
      }}
    />
  );
}
