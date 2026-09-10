import type { CommentThreadView } from "@velloo/schema";
import {
  Check,
  Cloud,
  Crosshair,
  MessageCircle,
  Plus,
  RotateCcw,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { type CloudCommentAvailability, type CommentScope, cloudUnavailableHint } from "../api.ts";
import { commentNumbers } from "../comment-order.ts";
import { submitOnModEnter } from "../keys.ts";
import { useCanvas } from "../store.ts";
import {
  CommentScopeFilterToggle,
  CommentTargetToggle,
  LOCAL_COMMENT_SCOPE_HELP,
} from "./CommentScopeControls.tsx";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog.tsx";
import { Badge } from "./ui/badge.tsx";
import { Bubble, BubbleContent } from "./ui/bubble.tsx";
import { Button } from "./ui/button.tsx";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "./ui/empty.tsx";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "./ui/input-group.tsx";
import { Message, MessageContent, MessageGroup, MessageHeader } from "./ui/message.tsx";
import { NativeSelect, NativeSelectOption } from "./ui/native-select.tsx";

function relativeTime(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h`;
  return `${Math.floor(minutes / 1440)}d`;
}

type AuthorKind = CommentThreadView["messages"][number]["author"]["kind"];

/** Only used when the message carries no name of its own — a folder-local one. */
const DEFAULT_AUTHOR_NAME: Record<AuthorKind, string> = {
  user: "You",
  agent: "Agent",
  reviewer: "Reviewer",
};

/**
 * A thread reads as a conversation, so each voice gets its own surface: yours
 * filled and right-aligned, your agent's muted, and a reviewer's outlined
 * because they are speaking from outside this machine — which is also why
 * theirs is the only one badged.
 */
const BUBBLE_VARIANT: Record<AuthorKind, "default" | "muted" | "outline"> = {
  user: "default",
  agent: "muted",
  reviewer: "outline",
};

/** What a message that was taken back leaves behind, in the panel and the list. */
const TOMBSTONE = "Comment deleted";

export function ThreadMessages({
  messages,
  onDelete,
}: {
  messages: CommentThreadView["messages"];
  onDelete?: (messageId: string) => void;
}) {
  return (
    <MessageGroup className="mt-2 gap-3">
      {messages.map((message) => {
        const kind = message.author.kind;
        const deleted = message.deletedAt !== undefined;
        // A reviewer wrote from their own browser under their own account, so
        // theirs isn't ours to take back — the cloud would refuse anyway.
        const removable = onDelete && !deleted && kind !== "reviewer";
        return (
          <Message key={message.id} align={kind === "user" ? "end" : "start"}>
            <MessageContent className="gap-1">
              <MessageHeader className="gap-1.5 px-3">
                {message.author.displayName ?? DEFAULT_AUTHOR_NAME[kind]}
                {kind === "reviewer" ? (
                  <Badge variant="outline" className="px-1 py-0 text-[9px] uppercase">
                    Reviewer
                  </Badge>
                ) : null}
                <span className="ml-auto font-normal">{relativeTime(message.createdAt)}</span>
                {removable ? (
                  <button
                    type="button"
                    className="-mr-1 rounded p-0.5 opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover/message:opacity-100"
                    title="Delete this comment"
                    aria-label="Delete this comment"
                    onClick={() => onDelete(message.id)}
                  >
                    <Trash2 size={11} />
                  </button>
                ) : null}
              </MessageHeader>
              {deleted ? (
                // Ghost: no surface, and the row goes flush left, so what's
                // left reads as a gap in the conversation rather than a turn.
                <Bubble variant="ghost">
                  <BubbleContent className="text-xs italic text-muted-foreground">
                    {TOMBSTONE}
                  </BubbleContent>
                </Bubble>
              ) : (
                <Bubble variant={BUBBLE_VARIANT[kind]}>
                  <BubbleContent className="whitespace-pre-wrap">{message.body}</BubbleContent>
                </Bubble>
              )}
            </MessageContent>
          </Message>
        );
      })}
    </MessageGroup>
  );
}

/** The opening line, skipping any that were taken back — never a blank row. */
function threadPreview(thread: CommentThreadView): string {
  return thread.messages.find((message) => !message.deletedAt)?.body ?? TOMBSTONE;
}

/** What the user is about to delete, held until they say so a second time. */
type PendingDelete = { kind: "thread" } | { kind: "message"; id: string };

/**
 * Deleting is one click and no undo, so the confirmation has to say what is
 * actually about to happen — which differs by where the thread lives and how
 * much of it the message is.
 */
function deletePrompt(thread: CommentThreadView, pending: PendingDelete): string {
  if (pending.kind === "thread") return "The conversation and its pin go, for good.";
  if (thread.scope === "shared")
    return "Anyone who has already read it will see that something was here, but not what it said.";
  if (thread.messages.length === 1)
    return "It's the only comment on this thread, so the thread goes with it.";
  return "It goes for good. The rest of the thread stays.";
}

export const MOVE_TO_CLOUD_HELP =
  "Moving a thread to the cloud republishes the conversation on the published board and removes the local copy. A board with no link yet is published first.";

export function CommentThreadListItem({
  thread,
  number,
  onOpen,
  onLocate,
}: {
  thread: CommentThreadView;
  number: number;
  onOpen(): void;
  onLocate(): void;
}) {
  return (
    <li className="relative">
      <button
        type="button"
        className={`w-full px-3 py-3 text-left hover:bg-muted/40 ${thread.anchor ? "pr-11" : ""}`}
        onClick={onOpen}
      >
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="font-medium tabular-nums">#{number}</span>
          {thread.scope === "shared" ? <Cloud size={11} /> : <MessageCircle size={11} />}
          <span>{thread.scope === "shared" ? "Cloud" : "Local"}</span>
          <span>
            {!thread.anchor
              ? "Board-wide"
              : thread.anchor.kind === "node"
                ? "Pinned comment"
                : "Board pin"}
          </span>
          {thread.anchorState.status === "stale" ? (
            <span className="text-destructive">target changed</span>
          ) : null}
          <span className="ml-auto">{relativeTime(thread.updatedAt)}</span>
        </div>
        <p className="mt-1 line-clamp-3 text-sm">{threadPreview(thread)}</p>
        {thread.messages.length > 1 ? (
          <span className="mt-1 block text-[11px] text-muted-foreground">
            {thread.messages.length} messages
          </span>
        ) : null}
      </button>
      {thread.anchor ? (
        <Button
          variant="ghost"
          size="icon-sm"
          className="absolute right-2 top-1/2 -translate-y-1/2"
          aria-label={`Go to comment ${number}`}
          title="Go to comment on canvas"
          onClick={onLocate}
        >
          <Crosshair />
        </Button>
      ) : null}
    </li>
  );
}

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
  const active = threads.find((thread) => thread.id === activeId) ?? null;
  const numbers = useMemo(() => commentNumbers(threads), [threads]);
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
      <div className="space-y-2 border-b px-3 py-2">
        <div className="flex items-center gap-2">
          <NativeSelect
            aria-label="Comment status"
            size="sm"
            className="w-auto text-xs"
            value={status}
            onChange={(event) => setStatus(event.target.value as typeof status)}
          >
            <NativeSelectOption value="open">Open</NativeSelectOption>
            <NativeSelectOption value="resolved">Resolved</NativeSelectOption>
            <NativeSelectOption value="all">All</NativeSelectOption>
          </NativeSelect>
          <span className="text-xs text-muted-foreground">{threads.length}</span>
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            title="Pin a new comment on the canvas"
            onClick={enterCommentMode}
          >
            <Plus /> Add
          </Button>
        </div>
        <CommentScopeFilterToggle scope={scope} onChange={setScope} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {active ? (
          <ThreadDetail
            thread={active}
            replyDraft={replyDraft}
            setReplyDraft={setReplyDraft}
            onBack={() => setActive(null)}
            onReply={() => void reply(active.id, replyDraft).then(() => setReplyDraft(""))}
            onResolve={() => void setResolved(active.id, active.status === "open")}
            cloud={cloud}
            onMoveToCloud={() => void moveToCloud(active.id)}
            onDelete={() => void deleteComment(active.id)}
            onDeleteMessage={(messageId) => void deleteMessage(active.id, messageId)}
          />
        ) : threads.length > 0 ? (
          <ul className="divide-y">
            {threads.map((thread) => (
              <CommentThreadListItem
                key={thread.id}
                thread={thread}
                number={numbers.get(thread.id) ?? 0}
                onOpen={() => setActive(thread.id)}
                onLocate={() => locateComment(thread.id)}
              />
            ))}
          </ul>
        ) : (
          <Empty className="h-full">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <MessageCircle />
              </EmptyMedia>
              <EmptyTitle>
                No {status === "all" ? "" : `${status} `}comments on this board.
              </EmptyTitle>
              <EmptyDescription>
                Add a pin on the canvas or start a broad thread below.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </div>
      {!active ? (
        <div className="border-t p-3" data-board-comment-composer>
          <InputGroup>
            <InputGroupTextarea
              aria-label="Start board-wide thread"
              value={boardDraft}
              onChange={(event) => setBoardDraft(event.target.value)}
              placeholder="Start a broad thread about this board…"
              className="min-h-16 text-sm"
              onKeyDown={submitOnModEnter(startThread)}
            />
            {/* Wraps because this row can't widen: the pane's own width is the
                budget, and a sign-in prompt beside the target toggle is enough
                to push submit off the edge. */}
            <InputGroupAddon align="block-end" className="flex-wrap">
              <CommentTargetToggle
                scope={boardScope}
                onChange={setBoardScope}
                cloud={cloud}
                className="min-w-0 flex-1"
              />
              <InputGroupButton
                variant="default"
                className="ml-auto"
                disabled={!boardDraft.trim()}
                onClick={startThread}
              >
                {boardFailure ? "Try again" : "Start thread"}
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
          {boardFailure ? (
            <p
              className="mt-1.5 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-[11px] text-destructive"
              data-comment-failure
              role="alert"
            >
              {boardFailure}
            </p>
          ) : null}
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            Board-wide threads have no canvas pin. {LOCAL_COMMENT_SCOPE_HELP}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function ThreadDetail({
  thread,
  replyDraft,
  setReplyDraft,
  onBack,
  onReply,
  onResolve,
  cloud,
  onMoveToCloud,
  onDelete,
  onDeleteMessage,
}: {
  thread: CommentThreadView;
  replyDraft: string;
  setReplyDraft(value: string): void;
  onBack(): void;
  onReply(): void;
  onResolve(): void;
  cloud: CloudCommentAvailability | undefined;
  onMoveToCloud(): void;
  onDelete(): void;
  onDeleteMessage(messageId: string): void;
}) {
  const blocked = cloud?.available === false ? cloud.reason : null;
  // An unpublished board is the one blocker the move itself clears: it opens
  // the publish flow on the way, so the button stays live and says so.
  const closed = Boolean(blocked) && blocked !== "unpublished";
  const [pending, setPending] = useState<PendingDelete | null>(null);
  const confirmDelete = () => {
    if (!pending) return;
    if (pending.kind === "thread") onDelete();
    else onDeleteMessage(pending.id);
    setPending(null);
  };
  return (
    <div className="flex min-h-full flex-col p-3" data-active-comment={thread.id}>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="sm" onClick={onBack}>
          ← Threads
        </Button>
        <span className="ml-auto flex items-center gap-1 text-[11px] text-muted-foreground">
          {thread.scope === "shared" ? <Cloud size={11} /> : <MessageCircle size={11} />}
          {thread.scope === "shared" ? "Cloud" : "Local"}
          <span>
            {thread.anchorState.status === "stale"
              ? "Target changed"
              : thread.anchor
                ? "Pinned"
                : "Board-wide"}
          </span>
        </span>
      </div>
      <ThreadMessages
        messages={thread.messages}
        onDelete={(id) => setPending({ kind: "message", id })}
      />
      {thread.status === "open" ? (
        <InputGroup className="mt-3">
          <InputGroupTextarea
            aria-label="Reply"
            value={replyDraft}
            onChange={(event) => setReplyDraft(event.target.value)}
            placeholder="Reply…"
            className="min-h-16 text-sm"
            onKeyDown={submitOnModEnter(onReply)}
          />
          <InputGroupAddon align="block-end">
            <InputGroupButton
              variant="default"
              className="ml-auto"
              disabled={!replyDraft.trim()}
              onClick={onReply}
            >
              Reply
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      ) : null}
      <div className="mt-auto grid grid-cols-2 gap-2 pt-4">
        {thread.status === "open" ? (
          <Button variant="outline" size="sm" onClick={onResolve}>
            <Check /> Resolve
          </Button>
        ) : (
          <Button variant="outline" size="sm" onClick={onResolve}>
            <RotateCcw /> Reopen
          </Button>
        )}
        {thread.scope === "local" ? (
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
        ) : null}
        {thread.scope === "local" ? (
          <Button
            variant="ghost"
            size="sm"
            className="col-span-2 text-destructive"
            onClick={() => setPending({ kind: "thread" })}
          >
            <Trash2 /> Delete thread
          </Button>
        ) : null}
      </div>

      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending?.kind === "thread" ? "Delete thread" : "Delete comment"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pending ? deletePrompt(thread, pending) : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={confirmDelete}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
