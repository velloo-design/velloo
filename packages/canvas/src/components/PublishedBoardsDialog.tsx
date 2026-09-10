import { ExternalLink, FileStack, Lock, ShieldCheck, Trash2, Unlock } from "lucide-react";
import { useEffect, useState } from "react";
import { type PublishedBoard, publish } from "../api.ts";
import { useCanvas } from "../store.ts";
import { pushToast, toastError } from "../toast.ts";
import { EmptyState } from "./EmptyState.tsx";
import { LoadingMark } from "./Loading.tsx";
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
import { Button } from "./ui/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog.tsx";
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "./ui/item.tsx";

/**
 * What this account has published, and the one thing the canvas can do about
 * it from here: take a link down.
 *
 * It exists because a published board was write-only from the canvas — you
 * could make one from the board menu and never see the pile again, which is
 * also what made the plan's board cap unanswerable from where you hit it. So
 * this is deliberately not a management console: the cloud's own page owns
 * renaming, access changes and version history, and the footer goes there.
 */

/** Enough to recognize the pile without turning the dialog into a table. */
const SHOWN = 10;

/** "2 days ago" — a published link is dated in relative terms everywhere else. */
export function publishedWhen(iso: string | null): string {
  if (!iso) return "date unknown";
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "date unknown";
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return new Date(then).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** The cloud's published-board page, or null when we can't build a URL we trust. */
export function publishedBoardsUrl(appUrl: string | undefined): string | null {
  if (!appUrl) return null;
  try {
    return new URL("/boards", appUrl).href;
  } catch {
    return null;
  }
}

function accessLabel(board: PublishedBoard): { icon: typeof Lock; text: string } {
  if (board.passwordProtected) return { icon: ShieldCheck, text: "Password protected" };
  if (board.visibility === "private") return { icon: Lock, text: "Your organization" };
  return { icon: Unlock, text: "Anyone with the link" };
}

export function PublishedBoardsDialog() {
  const open = useCanvas((s) => s.publishedBoardsOpen);
  const setOpen = useCanvas((s) => s.setPublishedBoardsOpen);
  const appUrl = useCanvas((s) => s.authStatus?.appUrl);
  const allUrl = publishedBoardsUrl(appUrl);

  /** Null while the first load is in flight; the fetch failure toasts and closes. */
  const [boards, setBoards] = useState<PublishedBoard[] | null>(null);
  const [pending, setPending] = useState<PublishedBoard | null>(null);
  const [removing, setRemoving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setBoards(null);
    let cancelled = false;
    void (async () => {
      try {
        const found = await publish.published();
        if (!cancelled) setBoards(found);
      } catch (err) {
        if (cancelled) return;
        toastError(err, "Could not read your published boards");
        setOpen(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, setOpen]);

  const remove = async (board: PublishedBoard) => {
    setRemoving(true);
    try {
      await publish.unpublish(board.slug);
      setBoards((current) => current?.filter((b) => b.slug !== board.slug) ?? null);
      // A freed slot is exactly what a board row's "see latest publish" and the
      // publish dialog's destination list were reading, so re-read them now
      // rather than at the end of the freshness window.
      void useCanvas.getState().refreshPublishSlots({ force: true });
      pushToast({
        kind: "success",
        message: `Unpublished ${board.title || board.slug} — the link no longer resolves.`,
      });
      setPending(null);
    } catch (err) {
      toastError(err, "Could not unpublish that board");
    } finally {
      setRemoving(false);
    }
  };

  const shown = boards?.slice(0, SHOWN) ?? [];

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => !next && setOpen(false)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Published boards</DialogTitle>
            <DialogDescription>
              Live links on velloo-cloud, newest first. Taking one down stops it resolving and frees
              the board slot it holds.
            </DialogDescription>
          </DialogHeader>

          {boards === null ? (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <LoadingMark size={16} />
              Reading velloo-cloud…
            </div>
          ) : shown.length === 0 ? (
            <EmptyState
              size="panel"
              icon={FileStack}
              title="Nothing published yet"
              hint="Publish a board from its menu in the sidebar to get a share link."
            />
          ) : (
            <ul
              className="-mx-1 max-h-[22rem] overflow-y-auto px-1"
              data-testid="published-boards-list"
            >
              {shown.map((board) => {
                const access = accessLabel(board);
                return (
                  <li key={board.slug}>
                    <Item variant="outline" size="sm" className="mb-1.5">
                      <ItemContent className="min-w-0">
                        <ItemTitle className="max-w-full">
                          <a
                            href={board.url}
                            target="_blank"
                            rel="noreferrer"
                            className="truncate text-inherit no-underline hover:underline"
                          >
                            {board.title || board.slug}
                          </a>
                          <ExternalLink size={12} className="shrink-0 text-muted-foreground" />
                        </ItemTitle>
                        <ItemDescription className="flex items-center gap-1.5 text-xs">
                          <access.icon size={11} className="shrink-0" />
                          {access.text} · {publishedWhen(board.lastPublishedAt)}
                        </ItemDescription>
                      </ItemContent>
                      <ItemActions>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          disabled={!board.canManage}
                          title={
                            board.canManage
                              ? "Unpublish this board"
                              : "A teammate published this — only they can take it down"
                          }
                          aria-label={`Unpublish ${board.title || board.slug}`}
                          onClick={() => setPending(board)}
                        >
                          {/* Red only when the click would actually do
                              something — a disabled destructive tint reads as
                              a live action the user simply mis-hit. */}
                          <Trash2 className={board.canManage ? "text-destructive" : undefined} />
                        </Button>
                      </ItemActions>
                    </Item>
                  </li>
                );
              })}
            </ul>
          )}

          <DialogFooter className="sm:justify-between">
            {allUrl ? (
              <Button variant="ghost" size="sm" asChild>
                <a
                  href={allUrl}
                  target="_blank"
                  rel="noreferrer"
                  data-testid="published-boards-all"
                >
                  <ExternalLink />
                  {boards && boards.length > shown.length
                    ? `See all ${boards.length} on velloo-cloud`
                    : "More details on velloo-cloud"}
                </a>
              </Button>
            ) : (
              <span />
            )}
            <Button variant="outline" onClick={() => setOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={pending !== null} onOpenChange={(next) => !next && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unpublish “{pending?.title || pending?.slug}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The share link stops resolving for everyone who has it, along with any comments left
              on it. Your local boards and screens are untouched, and publishing again mints a new
              link.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removing}>Keep it</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={removing}
              onClick={(event) => {
                // The dialog closes itself on action; keep it up until the
                // cloud answers so a failure lands somewhere the user is looking.
                event.preventDefault();
                if (pending) void remove(pending);
              }}
            >
              {removing ? "Unpublishing…" : "Unpublish"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
