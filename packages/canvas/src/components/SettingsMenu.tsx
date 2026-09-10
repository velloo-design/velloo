import {
  AlertTriangle,
  ArrowUpCircle,
  Coins,
  ExternalLink,
  FileStack,
  History,
  LogIn,
  LogOut,
  Settings,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";
import { useEffect, useState } from "react";
import { auth, type CloudAccount, fetchRevertStatus, type RevertStatus } from "../api.ts";
import { useCanvas } from "../store.ts";
import { pushToast, toastError } from "../toast.ts";
import { compactVersion, refreshUpdateStatus, upgradeVelloo, useUpdateState } from "../updates.ts";
import { RevertDialog } from "./RevertDialog.tsx";
import { Alert, AlertDescription } from "./ui/alert.tsx";
import { Avatar, AvatarFallback } from "./ui/avatar.tsx";
import { Button } from "./ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu.tsx";

/**
 * Top-right account menu. Signed in, the trigger is the user's avatar and
 * first name; signed out it stays a plain "Settings" button, because there is
 * no identity to show and the menu is then mostly the way in to signing up.
 *
 * The menu itself opens with Settings… (the folder/board/canvas dialog) and
 * closes with the destructive revert-all, with the account block — identity,
 * credits, upgrade, sign-out — between them. App theme moved into the
 * dialog's Canvas scope, alongside the other per-browser preferences.
 *
 * Account state is served live by the CLI daemon from `~/.velloo`, so signing in
 * from a terminal shows up here on the next menu open without a reload.
 */

const PLAN_LABEL: Record<string, string> = {
  free: "Free",
  team: "Team",
  business: "Business",
  enterprise: "Enterprise",
};

/** A tier as the product names it, falling back to whatever the cloud sent. */
export function planLabel(tier: string): string {
  return PLAN_LABEL[tier] ?? tier;
}

/**
 * Credit balance for the menu. Micros are the wire unit ($1 = 1_000_000); the
 * cents are what the user is actually watching drain, so they always show.
 */
function creditLabel(micros: number): string {
  return `$${(micros / 1_000_000).toFixed(2)}`;
}

/**
 * The name to greet someone by. First name only — the whole point of the
 * signed-in trigger is that it reads like a person, not a database row — with
 * the email's local part as the fallback when the cloud has no name on file.
 */
export function firstName(account: CloudAccount): string {
  const given = account.name?.trim().split(/\s+/)[0];
  if (given) return given;
  return account.email.split("@")[0] ?? account.email;
}

/** Up to two initials for the avatar: given + family, else the email's first two. */
export function initials(account: CloudAccount): string {
  const parts = account.name?.trim().split(/\s+/).filter(Boolean) ?? [];
  if (parts.length >= 2)
    return `${parts[0]?.[0] ?? ""}${parts[parts.length - 1]?.[0] ?? ""}`.toUpperCase();
  const source = parts[0] ?? account.email;
  return source.slice(0, 2).toUpperCase();
}

/** The cloud's billing page, or null when we can't build a URL we trust. */
export function billingUrl(appUrl: string | undefined): string | null {
  if (!appUrl) return null;
  try {
    return new URL("/billing", appUrl).href;
  } catch {
    return null;
  }
}

/** "api.velloo.ai" from a base URL — the whole URL is noise in a menu. */
function cloudLabel(cloudUrl: string | undefined): string {
  if (!cloudUrl) return "velloo-cloud";
  try {
    return new URL(cloudUrl).host;
  } catch {
    return cloudUrl;
  }
}

/**
 * The "there is a newer velloo" mark on the menu trigger. Purely decorative —
 * the menu item below it is the thing that is reachable and labelled — so it
 * is hidden from assistive tech rather than announced as an unlabelled dot.
 */
function UpdateDot() {
  return (
    <span
      aria-hidden="true"
      data-testid="settings-update-dot"
      className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-primary ring-2 ring-background"
    />
  );
}

export function SettingsMenu() {
  const status = useCanvas((s) => s.authStatus);
  const openSignIn = useCanvas((s) => s.openSignIn);
  const setSettingsScope = useCanvas((s) => s.setSettingsScope);
  const setPublishedBoardsOpen = useCanvas((s) => s.setPublishedBoardsOpen);
  const { status: update, upgrading } = useUpdateState();
  const updateReady = Boolean(update?.available && update.upgradable);

  // Revert availability, refreshed each time the menu opens. Null while
  // unknown; the item hides entirely when the folder isn't in a git repo.
  const [revertStatus, setRevertStatus] = useState<RevertStatus | null>(null);
  const [revertConfirm, setRevertConfirm] = useState<RevertStatus | null>(null);
  // Fired, never subscribed: the action is reached through getState so this
  // stays a mount-only (and menu-open) refresh with no reactive dependencies.
  const refresh = () => {
    void useCanvas.getState().refreshAuth();
    void refreshUpdateStatus();
    fetchRevertStatus()
      .then(setRevertStatus)
      .catch(() => setRevertStatus(null));
  };
  useEffect(refresh, []);

  const loggedIn = status?.loggedIn ?? false;
  const account = status?.account;
  // A token the cloud rejected still has a local email, so the menu can name
  // the account it can no longer use instead of just claiming "signed out".
  const expired = loggedIn && status?.verified === false;
  const plan = account?.tier ? `${planLabel(account.tier)} plan` : null;
  // Only nudge on a tier the cloud actually reported as free — an absent tier
  // means it didn't say, and guessing would show an upgrade to paid users.
  const upgradeUrl = account?.tier === "free" ? billingUrl(status?.appUrl) : null;
  const revertIsRepo =
    revertStatus !== null &&
    (revertStatus.available ||
      revertStatus.reason !== "The design folder is not inside a git repository.");

  const onLogout = async () => {
    try {
      await auth.logout();
      await useCanvas.getState().refreshAuth();
      pushToast({ kind: "success", message: "Signed out of velloo-cloud." });
    } catch (err) {
      toastError(err, "Could not sign out.");
    }
  };

  return (
    <>
      <DropdownMenu onOpenChange={(open) => open && refresh()}>
        <DropdownMenuTrigger asChild>
          {loggedIn && account ? (
            <Button
              variant="ghost"
              size="sm"
              className="relative max-w-[12rem] gap-2 pl-1 pr-2.5 text-xs"
              title={`${account.email} — account & settings`}
            >
              <Avatar aria-hidden="true" className="size-6">
                <AvatarFallback
                  className={
                    // An expired credential still shows the person, muted — the
                    // menu explains why, and a red avatar would read as an error
                    // with their identity rather than with the token.
                    "text-[10px] font-semibold " +
                    (expired
                      ? "bg-muted text-muted-foreground"
                      : "bg-primary text-primary-foreground")
                  }
                >
                  {initials(account)}
                </AvatarFallback>
              </Avatar>
              <span className="truncate">{firstName(account)}</span>
              {updateReady ? <UpdateDot /> : null}
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="relative max-w-[12rem] text-xs"
              title="Settings & account"
            >
              <Settings />
              <span className="truncate">Settings</span>
              {updateReady ? <UpdateDot /> : null}
            </Button>
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel className="font-normal">
            {loggedIn ? (
              <span className="flex flex-col gap-0.5">
                <span className="text-[11px] text-muted-foreground">
                  Signed in to {cloudLabel(status?.cloudUrl)}
                </span>
                <span className="truncate text-sm">
                  {account?.name ?? account?.email ?? "Signed in"}
                </span>
                {account?.name && account.email ? (
                  <span className="truncate text-[11px] text-muted-foreground">
                    {account.email}
                  </span>
                ) : null}
                {plan ? <span className="text-[11px] text-muted-foreground">{plan}</span> : null}
              </span>
            ) : (
              <span className="flex flex-col gap-0.5">
                <span className="text-[11px] text-muted-foreground">Not signed in</span>
                <span className="text-[11px] text-muted-foreground">
                  Sign in to publish boards and pull comments.
                </span>
              </span>
            )}
          </DropdownMenuLabel>
          {expired ? (
            <Alert variant="destructive" className="mb-1 gap-1.5 border-0 bg-transparent px-2 py-0">
              <AlertTriangle size={12} className="mt-px shrink-0" />
              <AlertDescription className="text-[11px] text-destructive">
                This credential expired — sign in again.
              </AlertDescription>
            </Alert>
          ) : null}
          {loggedIn ? (
            <>
              <DropdownMenuSeparator />
              {/* Image generation spends real money per click, and the panel
                  that spends it only reports the balance in a toast that has
                  already gone. This is the standing answer to "how much is
                  left" — it re-reads on every menu open. */}
              <div
                className="flex items-center justify-between gap-2 px-2 py-1.5 text-xs"
                data-testid="settings-credits"
              >
                <span className="flex items-center gap-2 text-muted-foreground">
                  <Coins size={14} className="shrink-0" />
                  Credits
                </span>
                {typeof account?.creditMicros === "number" ? (
                  <span className="font-medium tabular-nums">
                    {creditLabel(account.creditMicros)}
                  </span>
                ) : (
                  <span
                    className="text-muted-foreground"
                    title={
                      account?.creditMicros === null
                        ? "velloo-cloud couldn't read the balance just now."
                        : "This velloo-cloud doesn't report a credit balance."
                    }
                  >
                    —
                  </span>
                )}
              </div>
              {upgradeUrl ? (
                <DropdownMenuItem asChild>
                  <a
                    href={upgradeUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-inherit no-underline"
                    data-testid="settings-upgrade"
                  >
                    <Sparkles className="text-primary" />
                    Upgrade plan
                    <span className="ml-auto text-[10px] text-muted-foreground">Free</span>
                  </a>
                </DropdownMenuItem>
              ) : null}
            </>
          ) : null}
          <DropdownMenuSeparator />
          {/* The folder/board/canvas settings live in their own dialog; the
              rest of this menu is the account surface. Settings sits next to
              the cloud link because both are "go somewhere", not "do something". */}
          <DropdownMenuItem onSelect={() => setSettingsScope("folder")}>
            <SlidersHorizontal />
            Settings…
          </DropdownMenuItem>
          {/* Publishing was one-way from the canvas: the board menu made links
              and nothing here ever showed them again. This is the way back. */}
          {loggedIn ? (
            <DropdownMenuItem
              data-testid="settings-published-boards"
              onSelect={() => setPublishedBoardsOpen(true)}
            >
              <FileStack />
              Published boards…
            </DropdownMenuItem>
          ) : null}
          {loggedIn && status?.appUrl ? (
            <DropdownMenuItem asChild>
              <a
                href={status.appUrl}
                target="_blank"
                rel="noreferrer"
                className="text-inherit no-underline"
                data-testid="settings-open-cloud"
              >
                <ExternalLink />
                Open velloo-cloud
              </a>
            </DropdownMenuItem>
          ) : null}
          {/* Deliberately not next to "Upgrade plan": one buys a tier, the
              other replaces the binary, and adjacent "Upgrade …" items read as
              two halves of the same thing. */}
          {updateReady ? (
            <>
              <DropdownMenuItem
                disabled={upgrading}
                data-testid="settings-upgrade-velloo"
                title={`You're on ${update?.current}`}
                onSelect={(event) => {
                  // Keep the menu's own close out of it: the upgrade runs for
                  // seconds and reports through toasts, not through this menu.
                  event.preventDefault();
                  void upgradeVelloo();
                }}
              >
                <ArrowUpCircle className="text-primary" />
                {upgrading ? "Updating velloo…" : "Update velloo"}
              </DropdownMenuItem>
              {/* A local build's stamp carries a timestamp, which is far too
                  long for a right-aligned chip — it gets its own line, the way
                  the revert reason does. */}
              <div className="truncate px-2 pb-1 pl-8 text-[11px] text-muted-foreground">
                {compactVersion(update?.latest)}
              </div>
            </>
          ) : null}
          <DropdownMenuSeparator />
          {loggedIn && !expired ? (
            <DropdownMenuItem onSelect={onLogout}>
              <LogOut />
              Log out
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={() => openSignIn(expired ? { expired: true } : {})}>
              <LogIn />
              {expired ? "Sign in again…" : "Sign in to velloo-cloud…"}
            </DropdownMenuItem>
          )}
          {revertIsRepo ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                disabled={!revertStatus?.available}
                title={revertStatus?.available ? undefined : revertStatus?.reason}
                onSelect={() => setRevertConfirm(revertStatus)}
              >
                <History />
                Revert all design changes…
              </DropdownMenuItem>
              {!revertStatus?.available && revertStatus?.reason ? (
                <div className="px-2 pb-1 text-[11px] text-muted-foreground">
                  {revertStatus.reason}
                </div>
              ) : null}
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <RevertDialog
        status={revertConfirm}
        onClose={() => {
          setRevertConfirm(null);
          // A successful revert changes what's revertable — refresh so the
          // menu item disables itself next open.
          refresh();
        }}
      />
    </>
  );
}
