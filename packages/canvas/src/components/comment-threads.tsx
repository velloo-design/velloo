import type { CommentAuthorRole, CommentThreadView } from "@velloo/schema";
import {
  Check,
  Cloud,
  CloudUpload,
  Crosshair,
  MessageCircle,
  Plus,
  Reply,
  RotateCcw,
  Trash2,
  UserRound,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { submitOnModEnter } from "../keys.ts";
import { plainText } from "../markdown/parse.ts";
import { Markdown } from "./Markdown.tsx";
import { RichMarkdownEditor } from "./RichMarkdownEditor.tsx";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "./ui/alert-dialog.tsx";
import { Badge } from "./ui/badge.tsx";
import { Bubble, BubbleContent } from "./ui/bubble.tsx";
import { Button } from "./ui/button.tsx";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "./ui/empty.tsx";
import { InputGroup, InputGroupAddon, InputGroupButton } from "./ui/input-group.tsx";
import { Message, MessageContent, MessageGroup, MessageHeader } from "./ui/message.tsx";
import { NativeSelect, NativeSelectOption } from "./ui/native-select.tsx";

/*
 * The comment-thread UI with nothing behind it: every piece takes its threads
 * and callbacks as props, and none of it reads the canvas store or calls the
 * daemon.
 *
 * That is what lets it be shared. The canvas's CommentsPanel wires these to the
 * daemon; velloo-cloud's share viewer imports this same file (a sibling-repo
 * alias, like annotation-layout) and wires it to the public comment API. So a
 * reviewer on a share link and the designer on their canvas read the same rows,
 * bubbles and composer, and the two can't drift. Keep it that way: nothing here
 * may import `../store.ts` or `../api.ts`.
 */

type ThreadMessage = CommentThreadView["messages"][number];

/** A comment field inside an InputGroup, where the group draws the border. */
const COMPOSER_FIELD = "min-h-16 w-full flex-1 px-2.5 py-2 text-sm";
type AuthorKind = ThreadMessage["author"]["kind"];

export type CommentStatusFilter = "open" | "resolved" | "all";

function relativeTime(iso: string, now: number): string {
  const minutes = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h`;
  return `${Math.floor(minutes / 1440)}d`;
}

/** Half a minute, so a stamp is never more than one unit behind the clock. */
const RELATIVE_TICK_MS = 30_000;

/**
 * A stamp that keeps up with the clock.
 *
 * The label is read at render, and a comment pane sits untouched for as long
 * as the work beside it takes — so without a tick of its own a thread posted
 * a minute ago still reads "1m" an hour later.
 */
function RelativeTime({ iso, className }: { iso: string; className?: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), RELATIVE_TICK_MS);
    return () => clearInterval(timer);
  }, []);
  return (
    <time dateTime={iso} className={className}>
      {relativeTime(iso, now)}
    </time>
  );
}

/** Only used when neither the voice nor the message names the author. */
const DEFAULT_AUTHOR_NAME: Record<AuthorKind, string> = {
  user: "You",
  agent: "Agent",
  reviewer: "Reviewer",
};

/**
 * How one message is drawn: the side it speaks from, its surface, and a badge
 * for a voice its name alone doesn't identify.
 */
export interface MessageVoice {
  align: "start" | "end";
  variant: "default" | "muted" | "outline";
  /**
   * A visible tag beside the name. The canvas no longer sets one; kept for
   * share viewers built against the earlier shape.
   */
  badge?: string | undefined;
  /** Overrides the message's own name, for a reader its account name misleads. */
  name?: string | undefined;
  /** The author's role, shown as the name's tooltip rather than a tag. */
  role?: string | undefined;
  /** A small glyph after the name, labelled "Publisher" or "Guest". */
  marker?: AuthorMarker | undefined;
}

/**
 * How a role reads to people. An owner is an admin as far as anyone reading a
 * thread needs to know, so the two aren't told apart here.
 */
const ROLE_LABEL: Record<CommentAuthorRole, string> = {
  owner: "Admin",
  admin: "Admin",
  member: "Member",
  reviewer: "Reviewer",
  guest: "Guest",
};

export function roleLabel(role: CommentAuthorRole): string {
  return ROLE_LABEL[role];
}

export type AuthorMarker = "publisher" | "guest";

/**
 * The glyph after an author's name: whoever published the board, or a guest
 * without a seat in the organization. An agent is neither — it speaks for the
 * publisher but isn't them.
 *
 * A cloud that predates `publisher` only ever wrote `user` messages as the
 * link's owner, so those stand in for it. A local message is `user` too, but
 * carries no name — cloud messages always do — and a local note has no
 * publisher to point at.
 */
export function authorMarker(author: ThreadMessage["author"]): AuthorMarker | undefined {
  if (author.kind === "agent") return undefined;
  const publisher =
    author.publisher ?? (author.kind === "user" && author.displayName !== undefined);
  if (publisher) return "publisher";
  if (author.role === "guest") return "guest";
  return undefined;
}

const MARKER: Record<AuthorMarker, { label: string; Icon: typeof CloudUpload }> = {
  publisher: { label: "Publisher", Icon: CloudUpload },
  guest: { label: "Guest", Icon: UserRound },
};

/**
 * Who wrote a message, relative to the account signed in here. `kind` alone
 * can't say: a `reviewer` is anyone who wrote through the share page — the
 * signed-in person included — so the account id decides whenever both sides
 * carry one, and `kind` only when they don't (a local thread, an older cloud).
 */
function authorship(
  author: ThreadMessage["author"],
  selfAccountId: string | undefined,
): "mine" | "theirs" | "unknown" {
  if (!selfAccountId || !author.accountId) return "unknown";
  return author.accountId === selfAccountId ? "mine" : "theirs";
}

/**
 * The canvas's reading of a thread, for the account signed in here. It reads
 * as a conversation, so each voice gets its own surface: yours filled and
 * right-aligned, your agent's muted, and anyone else's outlined because they
 * are speaking from outside this machine.
 *
 * The owner's two voices are named by kind, not by the message: a cloud
 * message carries the account's name, and the person and their agent write
 * under the same account, so that name would put the agent's words in the
 * person's mouth.
 *
 * Who someone is stays out of the way until asked: their role is the name's
 * tooltip, and only the publisher and guests get a glyph — on your own
 * messages too, since you may well be the publisher.
 */
export function canvasVoiceFor(
  selfAccountId: string | undefined,
): (message: ThreadMessage) => MessageVoice {
  return (message) => {
    const { author } = message;
    if (author.kind === "agent") {
      return { align: "start", variant: "muted", name: DEFAULT_AUTHOR_NAME.agent };
    }
    const identity = {
      role: author.role ? roleLabel(author.role) : undefined,
      marker: authorMarker(author),
    };
    const who = authorship(author, selfAccountId);
    if (who === "mine" || (who === "unknown" && author.kind === "user")) {
      return { align: "end", variant: "default", name: DEFAULT_AUTHOR_NAME.user, ...identity };
    }
    return { align: "start", variant: "outline", ...identity };
  };
}

/**
 * Only your own messages are yours to take back — the cloud refuses the rest.
 * Without an account id to compare, a share-page author is assumed to be
 * someone else, which is what every such message was before ids were sent.
 */
export function canvasCanDeleteFor(
  selfAccountId: string | undefined,
): (message: ThreadMessage) => boolean {
  return (message) => {
    const who = authorship(message.author, selfAccountId);
    if (who !== "unknown") return who === "mine";
    return message.author.kind !== "reviewer";
  };
}

const canvasVoice = canvasVoiceFor(undefined);
const canvasCanDelete = canvasCanDeleteFor(undefined);

/** What a message that was taken back leaves behind, in the thread and the list. */
const TOMBSTONE = "Comment deleted";

export function ThreadMessages({
  messages,
  onDelete,
  voice = canvasVoice,
  canDelete = canvasCanDelete,
}: {
  messages: CommentThreadView["messages"];
  onDelete?: ((messageId: string) => void) | undefined;
  voice?: ((message: ThreadMessage) => MessageVoice) | undefined;
  canDelete?: ((message: ThreadMessage) => boolean) | undefined;
}) {
  return (
    <MessageGroup className="mt-2 gap-3">
      {messages.map((message) => {
        const deleted = message.deletedAt !== undefined;
        const removable = onDelete && !deleted && canDelete(message);
        const { align, variant, badge, name, role, marker } = voice(message);
        const markerInfo = marker ? MARKER[marker] : undefined;
        return (
          <Message key={message.id} align={align}>
            <MessageContent className="gap-1">
              <MessageHeader className="gap-1.5 px-3">
                <span title={role} className="truncate">
                  {name ?? message.author.displayName ?? DEFAULT_AUTHOR_NAME[message.author.kind]}
                </span>
                {markerInfo ? (
                  <markerInfo.Icon
                    size={11}
                    role="img"
                    aria-label={markerInfo.label}
                    className="-ml-0.5 shrink-0 text-muted-foreground"
                    data-author-marker={marker}
                  >
                    <title>{markerInfo.label}</title>
                  </markerInfo.Icon>
                ) : null}
                {badge ? (
                  <Badge variant="outline" className="px-1 py-0 text-[9px] uppercase">
                    {badge}
                  </Badge>
                ) : null}
                <RelativeTime iso={message.createdAt} className="ml-auto font-normal" />
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
                <Bubble variant={variant}>
                  <BubbleContent>
                    <Markdown body={message.body} />
                  </BubbleContent>
                </Bubble>
              )}
            </MessageContent>
          </Message>
        );
      })}
    </MessageGroup>
  );
}

/**
 * The opening line, skipping any that were taken back — never a blank row —
 * as words: a list row is a summary, not the formatted message.
 */
function threadPreview(thread: CommentThreadView): string {
  const body = thread.messages.find((message) => !message.deletedAt)?.body;
  return body === undefined ? TOMBSTONE : plainText(body);
}

/**
 * What the user is about to delete, held until they say so a second time. It
 * names its thread because the ask arrives from either the list or the open
 * thread, and one dialog answers both.
 */
export type PendingDelete =
  | { kind: "thread"; threadId: string }
  | { kind: "message"; threadId: string; id: string };

/**
 * Deleting is one click and no undo, so the confirmation has to say what is
 * actually about to happen — which differs by where the thread lives and how
 * much of it the message is.
 */
function deletePrompt(thread: CommentThreadView, pending: PendingDelete): string {
  if (pending.kind === "thread")
    return thread.anchor
      ? "The conversation and its pin go, for good."
      : "The conversation goes, for good.";
  if (thread.scope === "shared")
    return "Anyone who has already read it will see that something was here, but not what it said.";
  if (thread.messages.length === 1)
    return "It's the only comment on this thread, so the thread goes with it.";
  return "It goes for good. The rest of the thread stays.";
}

function anchorLabel(thread: CommentThreadView): string {
  if (!thread.anchor) return "Board-wide";
  return thread.anchor.kind === "node" ? "Pinned comment" : "Board pin";
}

/**
 * The canvas pin, restated at the head of the row: same chip, same number, so
 * a row and the pin it belongs to read as one thing across the two surfaces.
 * A board-wide thread has no pin to match, and says so by not being round.
 */
function ThreadPin({
  thread,
  number,
  showScope,
}: {
  thread: CommentThreadView;
  number: number;
  showScope: boolean;
}) {
  const stale = thread.anchorState.status === "stale";
  const tint = stale
    ? "border-destructive/40 bg-destructive/10 text-destructive group-hover/thread:bg-destructive group-hover/thread:text-destructive-foreground"
    : "border-primary/30 bg-primary/10 text-primary group-hover/thread:bg-primary group-hover/thread:text-primary-foreground";
  return (
    <span
      aria-hidden
      className={`flex h-6 shrink-0 items-center gap-0.5 border px-1.5 text-[11px] font-semibold tabular-nums transition-colors ${
        thread.anchor
          ? `rounded-full ${tint}`
          : "rounded-md border-dashed border-border bg-muted text-muted-foreground"
      }`}
    >
      {thread.anchor ? (
        showScope && thread.scope === "shared" ? (
          <Cloud size={9} />
        ) : (
          <MessageCircle size={9} />
        )
      ) : null}
      {number}
    </span>
  );
}

/** Separator between the meta line's facts, so they read as one sentence. */
function MetaDot() {
  return (
    <span aria-hidden className="text-border">
      •
    </span>
  );
}

/**
 * A thread at a glance, for a pin's hover card: who opened it, what they said,
 * and how much conversation is behind it. The full thread stays in the panel.
 */
export function ThreadPreview({
  thread,
  onOpen,
}: {
  thread: CommentThreadView;
  /** Absent where there is no fuller view to go to. */
  onOpen?: (() => void) | undefined;
}) {
  const first = thread.messages[0];
  if (!first) return null;
  const replies = thread.messages.length - 1;
  const name = first.author.displayName ?? DEFAULT_AUTHOR_NAME[first.author.kind];
  return (
    <div className="flex flex-col gap-1.5" data-comment-preview={thread.id}>
      <div className="flex items-baseline gap-2 pr-7 text-xs">
        <span className="font-medium text-foreground">{name}</span>
        <RelativeTime iso={first.createdAt} className="text-muted-foreground" />
        {thread.status === "resolved" ? (
          <span className="text-muted-foreground">· Resolved</span>
        ) : null}
      </div>
      {first.deletedAt ? (
        <p className="text-[13px] italic text-muted-foreground">Deleted</p>
      ) : (
        <Markdown
          body={first.body}
          className="max-h-24 overflow-hidden text-[13px] leading-relaxed text-foreground/85"
        />
      )}
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {replies === 0 ? "No replies" : replies === 1 ? "1 reply" : `${replies} replies`}
        </span>
        {onOpen ? (
          <button
            type="button"
            className="font-medium text-foreground underline-offset-2 hover:underline"
            onClick={onOpen}
          >
            Open thread
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function CommentThreadListItem({
  thread,
  number,
  onOpen,
  onLocate,
  onDelete,
  showScope = true,
}: {
  thread: CommentThreadView;
  number: number;
  onOpen(): void;
  onLocate(): void;
  /** Absent when the thread isn't this viewer's to remove — a cloud one. */
  onDelete?: (() => void) | undefined;
  /**
   * Say where the thread lives. Off on a share link, where every thread is a
   * cloud one and "Cloud" would be noise.
   */
  showScope?: boolean | undefined;
}) {
  const shared = thread.scope === "shared";
  const stale = thread.anchorState.status === "stale";
  const replies = thread.messages.length - 1;
  // The action cluster overlays the row's own button, so the text has to be
  // held clear of it whether or not the cluster is currently revealed.
  const actions = (thread.anchor ? 1 : 0) + (onDelete ? 1 : 0);
  return (
    <li
      className={`group/thread relative rounded-lg border bg-card shadow-sm transition-colors hover:bg-accent/40 ${
        stale ? "border-destructive/30" : "hover:border-primary/40"
      } ${thread.status === "resolved" ? "opacity-75" : ""}`}
      data-comment-row={thread.id}
    >
      <button
        type="button"
        className={`flex w-full items-start gap-2 p-2.5 text-left ${actions === 2 ? "pr-14" : actions === 1 ? "pr-9" : ""}`}
        onClick={onOpen}
      >
        <ThreadPin thread={thread} number={number} showScope={showScope} />
        <span className="min-w-0 flex-1">
          <span
            className={`line-clamp-2 text-sm leading-snug ${thread.status === "resolved" ? "text-muted-foreground" : ""}`}
          >
            {threadPreview(thread)}
          </span>
          <span className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-muted-foreground">
            {showScope ? (
              <>
                <span className="inline-flex items-center gap-1">
                  {shared ? <Cloud size={11} /> : <MessageCircle size={11} />}
                  {shared ? "Cloud" : "Local"}
                </span>
                <MetaDot />
              </>
            ) : null}
            <span>{anchorLabel(thread)}</span>
            <MetaDot />
            <RelativeTime iso={thread.updatedAt} />
            {replies > 0 ? (
              <Badge variant="secondary" className="h-4 gap-0.5 px-1.5 text-[10px] tabular-nums">
                <Reply />
                {replies}
              </Badge>
            ) : null}
            {stale ? (
              <Badge variant="destructive" className="h-4 px-1.5 text-[10px]">
                Target changed
              </Badge>
            ) : null}
            {thread.status === "resolved" ? (
              <Badge variant="outline" className="h-4 gap-0.5 px-1.5 text-[10px]">
                <Check />
                Resolved
              </Badge>
            ) : null}
          </span>
        </span>
      </button>
      {actions > 0 ? (
        <div className="absolute right-1.5 top-1.5 flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/thread:opacity-100">
          {thread.anchor ? (
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Go to comment ${number}`}
              title="Go to comment on canvas"
              onClick={onLocate}
            >
              <Crosshair />
            </Button>
          ) : null}
          {onDelete ? (
            <Button
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground hover:text-destructive"
              aria-label={`Delete thread ${number}`}
              title="Delete this thread"
              onClick={onDelete}
            >
              <Trash2 />
            </Button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

/** The list's head: which threads, how many, and the way to pin a new one. */
export function CommentListToolbar({
  status,
  onStatusChange,
  count,
  onAdd,
  children,
}: {
  status: CommentStatusFilter;
  onStatusChange(status: CommentStatusFilter): void;
  count: number;
  onAdd(): void;
  /** Anything else that narrows the list, under the row — the canvas's scope filter. */
  children?: ReactNode;
}) {
  return (
    <div className="space-y-2 border-b px-3 py-2">
      <div className="flex items-center gap-2">
        <NativeSelect
          aria-label="Comment status"
          size="sm"
          className="w-auto text-xs"
          value={status}
          onChange={(event) => onStatusChange(event.target.value as CommentStatusFilter)}
        >
          <NativeSelectOption value="open">Open</NativeSelectOption>
          <NativeSelectOption value="resolved">Resolved</NativeSelectOption>
          <NativeSelectOption value="all">All</NativeSelectOption>
        </NativeSelect>
        <span className="text-xs text-muted-foreground">{count}</span>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          title="Pin a new comment on the canvas"
          onClick={onAdd}
        >
          <Plus /> Add
        </Button>
      </div>
      {children}
    </div>
  );
}

export function CommentListEmpty({ status }: { status: CommentStatusFilter }) {
  return (
    <Empty className="h-full">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <MessageCircle />
        </EmptyMedia>
        <EmptyTitle>No {status === "all" ? "" : `${status} `}comments on this board.</EmptyTitle>
        <EmptyDescription>Add a pin on the canvas or start a broad thread below.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

/** Why a draft is still on screen after its submit — the words survive a refusal. */
export function CommentFailure({ children }: { children: ReactNode }) {
  return (
    <p
      className="mt-1.5 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-[11px] text-destructive"
      data-comment-failure
      role="alert"
    >
      {children}
    </p>
  );
}

/** The pane's foot: a thread about the whole board, with no pin on the canvas. */
export function BoardThreadComposer({
  draft,
  onDraftChange,
  onSubmit,
  failure,
  busy = false,
  target,
  help,
  className = "",
}: {
  draft: string;
  onDraftChange(draft: string): void;
  onSubmit(): void;
  failure: string | null;
  busy?: boolean | undefined;
  /** Where the thread will live, beside submit — the canvas's Local/Cloud choice. */
  target?: ReactNode;
  help?: ReactNode;
  className?: string | undefined;
}) {
  return (
    <div className={`border-t p-3 ${className}`} data-board-comment-composer>
      <InputGroup>
        <RichMarkdownEditor
          dataSlot="input-group-control"
          ariaLabel="Start board-wide thread"
          value={draft}
          onChange={onDraftChange}
          placeholder="Start a broad thread about this board…"
          className={COMPOSER_FIELD}
          onKeyDown={submitOnModEnter(onSubmit)}
        />
        {/* Wraps because this row can't widen: the pane's own width is the
            budget, and a sign-in prompt beside the target toggle is enough
            to push submit off the edge. */}
        <InputGroupAddon align="block-end" className="flex-wrap">
          {target}
          <InputGroupButton
            variant="default"
            className="ml-auto"
            disabled={busy || !draft.trim()}
            onClick={onSubmit}
          >
            {busy ? "Posting…" : failure ? "Try again" : "Start thread"}
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
      {failure ? <CommentFailure>{failure}</CommentFailure> : null}
      <p className="mt-1.5 text-[11px] text-muted-foreground">
        Board-wide threads have no canvas pin.{help ? <> {help}</> : null}
      </p>
    </div>
  );
}

/** One open thread: the conversation, a reply box, and what can be done with it. */
export function ThreadDetail({
  thread,
  showScope = true,
  voice,
  canDelete,
  onBack,
  onRequestDelete,
  replyDraft,
  onReplyDraftChange,
  onReply,
  canReply = true,
  replyFallback,
  busy = false,
  onResolve,
  children,
}: {
  thread: CommentThreadView;
  showScope?: boolean | undefined;
  voice?: ((message: ThreadMessage) => MessageVoice) | undefined;
  canDelete?: ((message: ThreadMessage) => boolean) | undefined;
  onBack(): void;
  onRequestDelete(pending: PendingDelete): void;
  replyDraft: string;
  onReplyDraftChange(draft: string): void;
  onReply(): void;
  /** False when this viewer can read the thread but not answer it yet. */
  canReply?: boolean | undefined;
  /** Shown in the reply box's place when `canReply` is false — a sign-in, say. */
  replyFallback?: ReactNode;
  busy?: boolean | undefined;
  /** Absent when this viewer can't close the thread. */
  onResolve?: (() => void) | undefined;
  /** Further actions, laid out beside Resolve. */
  children?: ReactNode;
}) {
  const open = thread.status === "open";
  return (
    <div className="flex min-h-full flex-col p-3" data-active-comment={thread.id}>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="sm" onClick={onBack}>
          ← Threads
        </Button>
        <span className="ml-auto flex items-center gap-1 text-[11px] text-muted-foreground">
          {showScope ? (
            <>
              {thread.scope === "shared" ? <Cloud size={11} /> : <MessageCircle size={11} />}
              {thread.scope === "shared" ? "Cloud" : "Local"}
            </>
          ) : null}
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
        voice={voice}
        canDelete={canDelete}
        onDelete={(id) => onRequestDelete({ kind: "message", threadId: thread.id, id })}
      />
      {open && canReply ? (
        <InputGroup className="mt-3">
          <RichMarkdownEditor
            dataSlot="input-group-control"
            ariaLabel="Reply"
            value={replyDraft}
            onChange={onReplyDraftChange}
            placeholder="Reply…"
            className={COMPOSER_FIELD}
            onKeyDown={submitOnModEnter(onReply)}
          />
          <InputGroupAddon align="block-end">
            <InputGroupButton
              variant="default"
              className="ml-auto"
              disabled={busy || !replyDraft.trim()}
              onClick={onReply}
            >
              Reply
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      ) : open ? (
        replyFallback
      ) : null}
      {onResolve || children ? (
        <div className="mt-auto grid grid-cols-2 gap-2 pt-4">
          {onResolve ? (
            <Button
              variant="outline"
              size="sm"
              className={children ? "" : "col-span-2"}
              disabled={busy}
              onClick={onResolve}
            >
              {open ? (
                <>
                  <Check /> Resolve
                </>
              ) : (
                <>
                  <RotateCcw /> Reopen
                </>
              )}
            </Button>
          ) : null}
          {children}
        </div>
      ) : null}
    </div>
  );
}

// Last in the file on purpose: vendored-ui.test reads an AlertDialogAction's
// chunk up to the next capitalised tag, and a pin tint's `bg-destructive`
// sitting below this would read as a restyled confirm button.
export function DeleteCommentDialog({
  thread,
  pending,
  onCancel,
  onConfirm,
}: {
  thread: CommentThreadView | null;
  pending: PendingDelete | null;
  onCancel(): void;
  onConfirm(): void;
}) {
  const open = thread !== null && pending !== null;
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <AlertDialogContent data-comment-delete-confirm>
        <AlertDialogHeader>
          <AlertDialogMedia className="text-destructive">
            <Trash2 />
          </AlertDialogMedia>
          <AlertDialogTitle>
            {pending?.kind === "message" ? "Delete comment" : "Delete thread"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {thread && pending ? deletePrompt(thread, pending) : ""}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onConfirm}>
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
