import type { CommentThreadView, OffBoardAnchor } from "@velloo/schema";
import { MessageCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { commentNumbers } from "../comment-order.ts";
import { signedInAccountId, useCanvas } from "../store.ts";
import {
  BoardThreadComposer,
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
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover.tsx";

/** Whether a thread is about exactly this Look, sketchbook or image — not one of its images. */
function isOn(thread: CommentThreadView, place: OffBoardAnchor): boolean {
  const anchor = thread.anchor;
  if (!anchor || anchor.kind !== place.kind || anchor.image !== place.image) return false;
  return anchor.kind === "look"
    ? place.kind === "look" && anchor.look === place.look
    : place.kind === "sketchbook" && anchor.sketchbook === place.sketchbook;
}

/**
 * The comments on a Look or one image: a badge with the open count that opens
 * the threads, each readable, answerable and resolvable in place — the
 * sketchbook has no comments pane beside it — and a box to start another.
 */
export function PlaceComments({
  place,
  label,
  className = "",
}: {
  place: OffBoardAnchor;
  /** What the comment is about, in the placeholder: "this Look", "this image". */
  label: string;
  className?: string;
}) {
  const all = useCanvas((s) => s.placeThreads);
  const reply = useCanvas((s) => s.replyToComment);
  const setResolved = useCanvas((s) => s.setCommentResolved);
  const deleteComment = useCanvas((s) => s.deleteComment);
  const deleteMessage = useCanvas((s) => s.deleteCommentMessage);
  const create = useCanvas((s) => s.createPlaceComment);
  const accountId = useCanvas(signedInAccountId);
  const signedIn = useCanvas((s) => s.authStatus?.loggedIn === true);
  const voice = useMemo(() => canvasVoiceFor(accountId), [accountId]);
  const canDelete = useMemo(() => canvasCanDeleteFor(accountId), [accountId]);
  const canActOn = useMemo(() => canvasCanActOnFor(signedIn), [signedIn]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const [draft, setDraft] = useState("");
  const [replyDraft, setReplyDraft] = useState("");
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingDelete | null>(null);

  const threads = all.filter((thread) => isOn(thread, place));
  const open = threads.filter((thread) => thread.status === "open");
  const shown = showResolved ? threads : open;
  const numbers = commentNumbers(threads);
  const active = threads.find((thread) => thread.id === openId) ?? null;
  const pendingThread = pending ? (threads.find((t) => t.id === pending.threadId) ?? null) : null;

  const start = () => {
    setFailure(null);
    void create(place, draft).then((refused) => {
      setFailure(refused);
      if (!refused) setDraft("");
    });
  };

  return (
    <>
      <Popover onOpenChange={(next) => !next && setOpenId(null)}>
        <PopoverTrigger asChild>
          <Button
            variant="secondary"
            size="xs"
            className={`gap-1 shadow-sm ${className}`}
            aria-label={
              open.length > 0
                ? `${open.length} open comment${open.length === 1 ? "" : "s"} on ${label}`
                : `Comment on ${label}`
            }
            title={`Comments on ${label}`}
            data-place-comments={
              place.image ?? (place.kind === "look" ? place.look : place.sketchbook)
            }
          >
            <MessageCircle />
            {open.length > 0 ? <span className="tabular-nums">{open.length}</span> : null}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 p-0" data-place-comments-popover>
          {active ? (
            <ThreadDetail
              thread={active}
              voice={voice}
              canDelete={canDelete}
              onBack={() => setOpenId(null)}
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
              {canActOn(active) ? (
                <DeleteThreadButton thread={active} onRequestDelete={setPending} />
              ) : null}
            </ThreadDetail>
          ) : (
            <div className="flex max-h-[28rem] flex-col">
              <div className="flex items-center gap-2 border-b px-3 py-2 text-xs">
                <span className="font-medium">Comments</span>
                <span className="text-muted-foreground">{open.length} open</span>
                {threads.length > open.length ? (
                  <Button
                    variant="link"
                    size="xs"
                    className="ml-auto h-auto px-0 text-xs"
                    onClick={() => setShowResolved((v) => !v)}
                  >
                    {showResolved
                      ? "Hide resolved"
                      : `Show resolved (${threads.length - open.length})`}
                  </Button>
                ) : null}
              </div>
              {shown.length > 0 ? (
                <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2">
                  {shown.map((thread) => (
                    <CommentThreadListItem
                      key={thread.id}
                      thread={thread}
                      number={numbers.get(thread.id) ?? 0}
                      onOpen={() => setOpenId(thread.id)}
                      onLocate={() => setOpenId(thread.id)}
                      onResolve={
                        canActOn(thread)
                          ? () => void setResolved(thread.id, thread.status === "open")
                          : undefined
                      }
                    />
                  ))}
                </ul>
              ) : null}
              <BoardThreadComposer
                className={shown.length > 0 ? "" : "border-t-0"}
                draft={draft}
                onDraftChange={setDraft}
                onSubmit={start}
                failure={failure}
                placeholder={`Comment on ${label}…`}
                ariaLabel={`Comment on ${label}`}
                note=""
              />
            </div>
          )}
        </PopoverContent>
      </Popover>
      <DeleteCommentDialog
        thread={pendingThread}
        pending={pending}
        onCancel={() => setPending(null)}
        onConfirm={() => {
          if (!pending) return;
          if (pending.kind === "thread") {
            void deleteComment(pending.threadId);
            setOpenId(null);
          } else void deleteMessage(pending.threadId, pending.id);
          setPending(null);
        }}
        onResolveInstead={() => {
          if (pending) void setResolved(pending.threadId, true);
          setPending(null);
        }}
      />
    </>
  );
}
