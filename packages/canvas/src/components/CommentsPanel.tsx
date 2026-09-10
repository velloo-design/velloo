import type { CommentThreadView } from "@velloo/schema";
import { Cloud, Trash2, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { type CloudCommentAvailability, type CommentScope, cloudUnavailableHint } from "../api.ts";
import { commentNumbers } from "../comment-order.ts";
import { useCanvas } from "../store.ts";
import {
  CommentScopeFilterToggle,
  CommentTargetToggle,
  LOCAL_COMMENT_SCOPE_HELP,
} from "./CommentScopeControls.tsx";
import {
  BoardThreadComposer,
  CommentListEmpty,
  CommentListToolbar,
  CommentThreadListItem,
  DeleteCommentDialog,
  type PendingDelete,
  ThreadDetail,
} from "./comment-threads.tsx";
import { Button } from "./ui/button.tsx";

export const MOVE_TO_CLOUD_HELP =
  "Moving a thread to the cloud republishes the conversation on the published board and removes the local copy. A board with no link yet is published first.";

export function CommentsPanel() {
  const boardId = useCanvas((state) => state.currentBoardId);
  const threads = useCanvas((state) => state.commentThreads);
  const status = useCanvas((state) => state.commentStatus);
  const scope = useCanvas((state) => state.commentScope);
  const cloud = useCanvas((state) => state.cloudComments);
  const activeId = useCanvas((state) => state.activeCommentId);
  const refresh = useCanvas((state) => state.refreshComments);
  const refreshCloud = useCanvas((state) => state.refreshCloudComments);
  const setStatus = useCanvas((state) => state.setCommentStatus);
  const setScope = useCanvas((state) => state.setCommentScope);
  const setActive = useCanvas((state) => state.setActiveComment);
  const locateComment = useCanvas((state) => state.locateComment);
  const createBoardComment = useCanvas((state) => state.createBoardComment);
  const reply = useCanvas((state) => state.replyToComment);
  const setResolved = useCanvas((state) => state.setCommentResolved);
  const moveToCloud = useCanvas((state) => state.moveCommentToCloud);
  const deleteComment = useCanvas((state) => state.deleteComment);
  const deleteMessage = useCanvas((state) => state.deleteCommentMessage);
  const enterCommentMode = useCanvas((state) => state.enterCommentMode);
  const [boardDraft, setBoardDraft] = useState("");
  const [boardScope, setBoardScope] = useState<CommentScope>("local");
  const [boardFailure, setBoardFailure] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState("");
  const [pending, setPending] = useState<PendingDelete | null>(null);
  const active = threads.find((thread) => thread.id === activeId) ?? null;
  const numbers = useMemo(() => commentNumbers(threads), [threads]);
  const pendingThread = pending
    ? (threads.find((thread) => thread.id === pending.threadId) ?? null)
    : null;
  const confirmDelete = () => {
    if (!pending) return;
    if (pending.kind === "thread") void deleteComment(pending.threadId);
    else void deleteMessage(pending.threadId, pending.id);
    setPending(null);
  };
  // The draft survives a refused post — a cloud comment can lose its publish
  // and the words are the part that took work.
  const startThread = () => {
    setBoardFailure(null);
    void createBoardComment(boardDraft, boardScope).then((failure) => {
      setBoardFailure(failure);
      if (!failure) setBoardDraft("");
    });
  };

  useEffect(() => {
    if (boardId) void refresh();
  }, [boardId, refresh]);

  useEffect(() => {
    void refreshCloud();
  }, [refreshCloud]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the active thread id is intentionally the reset trigger
  useEffect(() => {
    setReplyDraft("");
  }, [activeId]);

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-velloo-comments-panel>
      <CommentListToolbar
        status={status}
        onStatusChange={setStatus}
        count={threads.length}
        onAdd={enterCommentMode}
      >
        <CommentScopeFilterToggle scope={scope} onChange={setScope} />
      </CommentListToolbar>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {active ? (
          <ThreadDetail
            thread={active}
            onBack={() => setActive(null)}
            onRequestDelete={setPending}
            replyDraft={replyDraft}
            onReplyDraftChange={setReplyDraft}
            onReply={() => void reply(active.id, replyDraft).then(() => setReplyDraft(""))}
            onResolve={() => void setResolved(active.id, active.status === "open")}
          >
            {active.scope === "local" ? (
              <LocalThreadActions
                thread={active}
                cloud={cloud}
                onMoveToCloud={() => void moveToCloud(active.id)}
                onRequestDelete={setPending}
              />
            ) : null}
          </ThreadDetail>
        ) : threads.length > 0 ? (
          <ul className="space-y-1.5 p-2">
            {threads.map((thread) => (
              <CommentThreadListItem
                key={thread.id}
                thread={thread}
                number={numbers.get(thread.id) ?? 0}
                onOpen={() => setActive(thread.id)}
                onLocate={() => locateComment(thread.id)}
                // A cloud thread has been read by other people, and the daemon
                // refuses to erase it — resolving is the only close it has.
                onDelete={
                  thread.scope === "local"
                    ? () => setPending({ kind: "thread", threadId: thread.id })
                    : undefined
                }
              />
            ))}
          </ul>
        ) : (
          <CommentListEmpty status={status} />
        )}
      </div>
      {!active ? (
        <BoardThreadComposer
          draft={boardDraft}
          onDraftChange={setBoardDraft}
          onSubmit={startThread}
          failure={boardFailure}
          target={
            <CommentTargetToggle
              scope={boardScope}
              onChange={setBoardScope}
              cloud={cloud}
              className="min-w-0 flex-1"
            />
          }
          help={LOCAL_COMMENT_SCOPE_HELP}
        />
      ) : null}

      <DeleteCommentDialog
        thread={pendingThread}
        pending={pending}
        onCancel={() => setPending(null)}
        onConfirm={confirmDelete}
      />
    </div>
  );
}

/** What only a thread on this machine can do: leave for the cloud, or go. */
function LocalThreadActions({
  thread,
  cloud,
  onMoveToCloud,
  onRequestDelete,
}: {
  thread: CommentThreadView;
  cloud: CloudCommentAvailability | undefined;
  onMoveToCloud(): void;
  onRequestDelete(pending: PendingDelete): void;
}) {
  const blocked = cloud?.available === false ? cloud.reason : null;
  // An unpublished board is the one blocker the move itself clears: it opens
  // the publish flow on the way, so the button stays live and says so.
  const closed = Boolean(blocked) && blocked !== "unpublished";
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        disabled={cloud === undefined || closed}
        title={closed && blocked ? cloudUnavailableHint(blocked) : MOVE_TO_CLOUD_HELP}
        onClick={onMoveToCloud}
      >
        <Cloud /> Move to cloud
        {blocked === "unpublished" ? <TriangleAlert className="text-amber-600" /> : null}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="col-span-2 text-destructive"
        onClick={() => onRequestDelete({ kind: "thread", threadId: thread.id })}
      >
        <Trash2 /> Delete thread
      </Button>
    </>
  );
}
