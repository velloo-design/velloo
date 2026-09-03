import type { CommentThreadView } from "@velloo/schema";
import { Bot, Check, Cloud, MapPin, MessageCircle, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useCanvas } from "../store.ts";
import { Button } from "./ui/button.tsx";
import { Textarea } from "./ui/textarea.tsx";

function relativeTime(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h`;
  return `${Math.floor(minutes / 1440)}d`;
}

export function CommentsPanel() {
  const boardId = useCanvas((state) => state.currentBoardId);
  const threads = useCanvas((state) => state.commentThreads);
  const status = useCanvas((state) => state.commentStatus);
  const activeId = useCanvas((state) => state.activeCommentId);
  const refresh = useCanvas((state) => state.refreshComments);
  const setStatus = useCanvas((state) => state.setCommentStatus);
  const setActive = useCanvas((state) => state.setActiveComment);
  const createBoardComment = useCanvas((state) => state.createBoardComment);
  const reply = useCanvas((state) => state.replyToComment);
  const setResolved = useCanvas((state) => state.setCommentResolved);
  const setAgentRequested = useCanvas((state) => state.setCommentAgentRequested);
  const deleteComment = useCanvas((state) => state.deleteComment);
  const enterCommentMode = useCanvas((state) => state.enterCommentMode);
  const [boardDraft, setBoardDraft] = useState("");
  const [replyDraft, setReplyDraft] = useState("");
  const active = threads.find((thread) => thread.id === activeId) ?? null;

  useEffect(() => {
    if (boardId) void refresh();
  }, [boardId, refresh]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the active thread id is intentionally the reset trigger
  useEffect(() => {
    setReplyDraft("");
  }, [activeId]);

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-velloo-comments-panel>
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <select
          aria-label="Comment status"
          className="h-7 rounded border bg-background px-2 text-xs"
          value={status}
          onChange={(event) => setStatus(event.target.value as typeof status)}
        >
          <option value="open">Open</option>
          <option value="resolved">Resolved</option>
          <option value="all">All</option>
        </select>
        <span className="text-xs text-muted-foreground">{threads.length}</span>
        <Button variant="outline" size="sm" className="ml-auto" onClick={enterCommentMode}>
          <MapPin /> Add pin
        </Button>
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
            onAskAgent={() => void setAgentRequested(active.id, !active.agentRequestedAt)}
            onDelete={() => void deleteComment(active.id)}
          />
        ) : threads.length > 0 ? (
          <ul className="divide-y">
            {threads.map((thread) => (
              <li key={thread.id}>
                <button
                  type="button"
                  className="w-full px-3 py-3 text-left hover:bg-muted/40"
                  onClick={() => setActive(thread.id)}
                >
                  <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    {thread.scope === "shared" ? <Cloud size={11} /> : <MessageCircle size={11} />}
                    <span>{thread.scope === "shared" ? "Shared" : "Local"}</span>
                    <span>
                      {!thread.anchor
                        ? "Board-wide"
                        : thread.anchor.kind === "node"
                          ? "Pinned element"
                          : "Board pin"}
                    </span>
                    {thread.anchorState.status === "stale" ? (
                      <span className="text-destructive">target changed</span>
                    ) : null}
                    {thread.agentRequestedAt ? (
                      <Bot className="ml-auto text-primary" size={12} />
                    ) : null}
                    <span className={thread.agentRequestedAt ? "" : "ml-auto"}>
                      {relativeTime(thread.updatedAt)}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-3 text-sm">{thread.messages[0]?.body}</p>
                  {thread.messages.length > 1 ? (
                    <span className="mt-1 block text-[11px] text-muted-foreground">
                      {thread.messages.length} messages
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="grid h-full place-items-center p-6 text-center text-xs text-muted-foreground">
            <div>
              <MessageCircle className="mx-auto mb-2" size={22} />
              <p>No {status === "all" ? "" : `${status} `}comments on this board.</p>
              <p className="mt-1">Add a pin on the canvas or start a broad thread below.</p>
            </div>
          </div>
        )}
      </div>
      {!active ? (
        <div className="border-t p-3" data-board-comment-composer>
          <Textarea
            aria-label="Start board-wide thread"
            value={boardDraft}
            onChange={(event) => setBoardDraft(event.target.value)}
            placeholder="Start a broad thread about this board…"
            className="min-h-16 resize-none text-sm"
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                void createBoardComment(boardDraft).then(() => setBoardDraft(""));
              }
            }}
          />
          <Button
            size="sm"
            className="mt-2 w-full"
            disabled={!boardDraft.trim()}
            onClick={() => void createBoardComment(boardDraft).then(() => setBoardDraft(""))}
          >
            Start thread
          </Button>
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            Board-wide threads have no canvas pin.
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
  onAskAgent,
  onDelete,
}: {
  thread: CommentThreadView;
  replyDraft: string;
  setReplyDraft(value: string): void;
  onBack(): void;
  onReply(): void;
  onResolve(): void;
  onAskAgent(): void;
  onDelete(): void;
}) {
  return (
    <div className="flex min-h-full flex-col p-3" data-active-comment={thread.id}>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="sm" onClick={onBack}>
          ← Threads
        </Button>
        <span className="ml-auto text-[11px] text-muted-foreground">
          {thread.anchorState.status === "stale"
            ? "Target changed"
            : thread.anchor
              ? "Pinned"
              : "Board-wide"}
        </span>
      </div>
      <div className="mt-2 space-y-2">
        {thread.messages.map((message) => (
          <div key={message.id} className="rounded-md border bg-card p-2.5">
            <div className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
              {message.author.kind === "agent" ? <Bot size={11} /> : <MessageCircle size={11} />}
              {message.author.displayName ?? (message.author.kind === "agent" ? "Agent" : "You")}
              <span className="ml-auto">{relativeTime(message.createdAt)}</span>
            </div>
            <p className="mt-1 whitespace-pre-wrap text-sm">{message.body}</p>
          </div>
        ))}
      </div>
      {thread.status === "open" ? (
        <div className="mt-3">
          <Textarea
            aria-label="Reply"
            value={replyDraft}
            onChange={(event) => setReplyDraft(event.target.value)}
            placeholder="Reply…"
            className="min-h-16 resize-none text-sm"
          />
          <Button size="sm" className="mt-2 w-full" disabled={!replyDraft.trim()} onClick={onReply}>
            Reply
          </Button>
        </div>
      ) : null}
      <div className="mt-auto grid grid-cols-2 gap-2 pt-4">
        {thread.status === "open" && thread.scope === "shared" ? (
          <Button variant="outline" size="sm" disabled>
            <Bot /> Agent aware
          </Button>
        ) : thread.status === "open" ? (
          <Button
            variant={thread.agentRequestedAt ? "default" : "outline"}
            size="sm"
            onClick={onAskAgent}
          >
            <Bot /> {thread.agentRequestedAt ? "Queued" : "Ask agent"}
          </Button>
        ) : (
          <Button variant="outline" size="sm" onClick={onResolve}>
            <RotateCcw /> Reopen
          </Button>
        )}
        {thread.status === "open" ? (
          <Button variant="outline" size="sm" onClick={onResolve}>
            <Check /> Resolve
          </Button>
        ) : null}
        {thread.scope === "local" ? (
          <Button
            variant="ghost"
            size="sm"
            className="col-span-2 text-destructive"
            onClick={onDelete}
          >
            <Trash2 /> Delete thread
          </Button>
        ) : null}
      </div>
    </div>
  );
}
