import type { CommentThreadView } from "@velloo/schema";
import { Cloud, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { type CloudCommentAvailability, type CommentScope, cloudUnavailableHint } from "../api.ts";
import { commentNumbers } from "../comment-order.ts";
import { signedInAccountId, useCanvas } from "../store.ts";
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
  canvasCanActOnFor,
  canvasCanDeleteFor,
  canvasVoiceFor,
  DeleteCommentDialog,
  DeleteThreadButton,
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
  const accountId = useCanvas(signedInAccountId);
  const voice = useMemo(() => canvasVoiceFor(accountId), [accountId]);
  const canDelete = useMemo(() => canvasCanDeleteFor(accountId), [accountId]);
  const signedIn = useCanvas((state) => state.authStatus?.loggedIn === true);
  const canActOn = useMemo(() => canvasCanActOnFor(signedIn), [signedIn]);
  const pendingThread = pending
    ? (threads.find((thread) => thread.id === pending.threadId) ?? null)
    : null;
  const resolveInstead = () => {
    if (pending) void setResolved(pending.threadId, true);
    setPending(null);
  };
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
            voice={voice}
            canDelete={canDelete}
            onBack={() => setActive(null)}
            onRequestDelete={setPending}
            replyDraft={replyDraft}
            onReplyDraftChange={setReplyDraft}
            onReply={() => void reply(active.id, replyDraft).then(() => setReplyDraft(""))}
            onResolve={
              canActOn(active)
                ? () => void setResolved(active.id, active.status === "open")
                : undefined
            }
          >
            {active.scope === "local" ? (
              <LocalThreadActions
                thread={active}
                cloud={cloud}
                onMoveToCloud={() => void moveToCloud(active.id)}
                onRequestDelete={setPending}
              />
            ) : canActOn(active) ? (
              <DeleteThreadButton thread={active} onRequestDelete={setPending} />
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
                onResolve={
                  canActOn(thread)
                    ? () => void setResolved(thread.id, thread.status === "open")
                    : undefined
                }
                onDelete={
                  canActOn(thread)
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
        onResolveInstead={resolveInstead}
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
      <DeleteThreadButton thread={thread} onRequestDelete={onRequestDelete} />
    </>
  );
}
