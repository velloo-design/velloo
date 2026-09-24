import { guestsAllowed } from "@velloo/protocol";
import { Copy, Link2, Lock, Mail, MoreHorizontal, Trash2, UserPlus, Users } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { type GuestInvite, type PublishGuest, publish } from "../api.ts";
import { useCanvas } from "../store.ts";
import { pushToast, toastError } from "../toast.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { EmptyState } from "./EmptyState.tsx";
import { LoadingMark } from "./Loading.tsx";
import { publishedWhen } from "./PublishedBoardsDialog.tsx";
import { billingUrl } from "./SettingsMenu.tsx";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "./ui/alert.tsx";
import { Button } from "./ui/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu.tsx";
import { Input } from "./ui/input.tsx";
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "./ui/item.tsx";
import { Label } from "./ui/label.tsx";

/**
 * Share one published board with people outside the organization.
 *
 * A guest needs no account: the cloud emails them a personal link that opens
 * this board, and nothing else, as them. The cloud keeps only a hash of that
 * link, so there is never an old one to show again — "Copy link" and "Resend"
 * both mint a new one and retire the last. The copy says so, because a guest
 * who is sent a second link and then opens the first finds it dead.
 */

/** A link someone has to pass on by hand, and why. */
interface Handover {
  who: string;
  url: string;
  note: string;
}

const who = (guest: PublishGuest): string => guest.name || guest.email || "this guest";

export function GuestsDialog() {
  const board = useCanvas((s) => s.guestsBoard);
  const openGuests = useCanvas((s) => s.openGuests);
  const allowed = useCanvas((s) => guestsAllowed(s.authStatus?.account?.tier));
  const upgradeUrl = useCanvas((s) => billingUrl(s.authStatus?.appUrl));

  /** Null while the list loads. */
  const [guests, setGuests] = useState<PublishGuest[] | null>(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [handover, setHandover] = useState<Handover | null>(null);
  const [removing, setRemoving] = useState<PublishGuest | null>(null);

  const slug = board?.slug ?? null;

  useEffect(() => {
    if (!slug) return;
    setGuests(null);
    setEmail("");
    setName("");
    setHandover(null);
    setRemoving(null);
    let cancelled = false;
    void publish.guests
      .list(slug)
      .then((found) => {
        if (!cancelled) setGuests(found);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        toastError(err, "Could not read this board's guests");
        setGuests([]);
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const close = () => openGuests(null);

  /** Put a guest in the list, replacing their old row — re-inviting updates one. */
  const upsert = (guest: PublishGuest) =>
    setGuests((current) => [...(current ?? []).filter((g) => g.id !== guest.id), guest]);

  /** Tell the user what reached the guest, or hand them the link when email didn't. */
  const delivered = (invite: GuestInvite, sent: string) => {
    upsert(invite.guest);
    if (invite.emailed || !invite.guestUrl) {
      pushToast({ kind: "success", message: sent });
      setHandover(null);
      return;
    }
    setHandover({
      who: who(invite.guest),
      url: invite.guestUrl,
      note: `Email isn't available here${invite.reason ? ` (${invite.reason})` : ""}, so send this link yourself.`,
    });
  };

  const invite = async (event: FormEvent) => {
    event.preventDefault();
    if (!slug || !email.trim()) return;
    setBusy(true);
    try {
      const invited = await publish.guests.invite(slug, {
        email: email.trim(),
        ...(name.trim() ? { name: name.trim() } : {}),
      });
      delivered(invited, `Invited ${who(invited.guest)} — they'll get an email with their link.`);
      setEmail("");
      setName("");
    } catch (err) {
      toastError(err, "Could not invite that guest");
    } finally {
      setBusy(false);
    }
  };

  const resend = async (guest: PublishGuest) => {
    if (!slug) return;
    try {
      const sent = await publish.guests.resend(slug, guest.id);
      delivered(sent, `Emailed ${who(guest)} a new link — the one they had stops working.`);
    } catch (err) {
      toastError(err, "Could not resend that guest's link");
    }
  };

  const copyNewLink = async (guest: PublishGuest) => {
    if (!slug) return;
    try {
      const url = await publish.guests.link(slug, guest.id);
      setHandover({ who: who(guest), url, note: "The link they had before no longer works." });
      await copy(url, "New guest link copied — the one they had before no longer works.");
    } catch (err) {
      toastError(err, "Could not make a new link for that guest");
    }
  };

  const remove = async (guest: PublishGuest) => {
    if (!slug) return;
    setRemoving(null);
    try {
      await publish.guests.remove(slug, guest.id);
      setGuests((current) => current?.filter((g) => g.id !== guest.id) ?? null);
      if (handover?.who === who(guest)) setHandover(null);
      pushToast({ kind: "success", message: `${who(guest)} can no longer open this board.` });
    } catch (err) {
      toastError(err, "Could not remove that guest");
    }
  };

  return (
    <>
      <Dialog open={board !== null} onOpenChange={(next) => !next && close()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Guests on “{board?.title}”</DialogTitle>
            <DialogDescription>
              People outside your organization who can open this board, and only this board, through
              a personal link. They don't need an account.
            </DialogDescription>
          </DialogHeader>

          {allowed ? null : (
            // An offer, not an error — `note` keeps screen readers from
            // announcing it the way the Alert's default `alert` role would.
            <Alert role="note" data-testid="guests-upsell">
              <Lock />
              <AlertTitle>Invite guests</AlertTitle>
              <AlertDescription className="text-xs">
                Share a board with people outside your organization by email. Upgrade your plan to
                invite guests.
              </AlertDescription>
              {upgradeUrl && (
                <AlertAction>
                  <Button size="xs" variant="secondary" asChild>
                    <a href={upgradeUrl} target="_blank" rel="noreferrer">
                      Upgrade
                    </a>
                  </Button>
                </AlertAction>
              )}
            </Alert>
          )}

          <form className="grid gap-2" onSubmit={(event) => void invite(event)}>
            <div className="grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[3fr_2fr]">
              <div className="grid gap-1.5">
                <Label htmlFor="guest-email">Email</Label>
                <Input
                  id="guest-email"
                  type="email"
                  autoComplete="off"
                  placeholder="name@company.com"
                  value={email}
                  disabled={!allowed || busy}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="guest-name">Name (optional)</Label>
                <Input
                  id="guest-name"
                  autoComplete="off"
                  value={name}
                  disabled={!allowed || busy}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
            </div>
            <Button
              type="submit"
              size="sm"
              className="justify-self-start"
              disabled={!allowed || busy || !email.trim()}
            >
              <UserPlus />
              {busy ? "Inviting…" : "Invite"}
            </Button>
          </form>

          {handover ? (
            <div
              className="grid gap-1.5 rounded-md border bg-muted/40 p-2"
              data-testid="guest-handover"
            >
              <p className="text-xs text-muted-foreground">
                Link for {handover.who}. {handover.note}
              </p>
              <div className="flex items-center gap-2">
                <Input readOnly value={handover.url} className="font-mono text-xs" />
                <Button
                  variant="outline"
                  size="icon-sm"
                  title="Copy link"
                  aria-label="Copy guest link"
                  onClick={() => void copy(handover.url, "Guest link copied.")}
                >
                  <Copy />
                </Button>
              </div>
            </div>
          ) : null}

          {guests === null ? (
            <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
              <LoadingMark size={16} />
              Reading guests…
            </div>
          ) : guests.length === 0 ? (
            <EmptyState
              size="panel"
              icon={Users}
              title="No guests yet"
              hint="Invite someone by email and they'll get a link to this board."
            />
          ) : (
            <ul className="-mx-1 max-h-64 overflow-y-auto px-1" data-testid="guests-list">
              {guests.map((guest) => (
                <li key={guest.id}>
                  <Item variant="outline" size="sm" className="mb-1.5">
                    <ItemContent className="min-w-0">
                      <ItemTitle className="max-w-full truncate">{who(guest)}</ItemTitle>
                      <ItemDescription className="truncate text-xs">
                        {guest.name && guest.email ? `${guest.email} · ` : ""}
                        {guest.lastSeenAt
                          ? `Last opened ${publishedWhen(guest.lastSeenAt)}`
                          : "Not opened yet"}
                      </ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Actions for ${who(guest)}`}
                          >
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            disabled={!allowed}
                            onSelect={() => void copyNewLink(guest)}
                            title="Makes a new link — the one they had stops working"
                          >
                            <Link2 />
                            Copy a new link
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={!allowed}
                            onSelect={() => void resend(guest)}
                            title="Emails a new link — the one they had stops working"
                          >
                            <Mail />
                            Email a new link
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            variant="destructive"
                            onSelect={() => setRemoving(guest)}
                          >
                            <Trash2 />
                            Remove
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </ItemActions>
                  </Item>
                </li>
              ))}
            </ul>
          )}

          <p className="text-[11px] text-muted-foreground">
            A new link, copied or emailed, replaces the one the guest had.
          </p>

          <DialogFooter>
            <Button variant="outline" onClick={close}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={removing !== null}
        title={`Remove ${removing ? who(removing) : "this guest"}?`}
        description="Their link stops working right away. You can invite them again later."
        confirmLabel="Remove"
        onConfirm={() => {
          if (removing) void remove(removing);
        }}
        onCancel={() => setRemoving(null)}
      />
    </>
  );
}

async function copy(url: string, done: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(url);
    pushToast({ kind: "success", message: done });
  } catch {
    // The link is on screen in the hand-over box either way.
  }
}
