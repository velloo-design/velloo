import { AlertTriangle, History, LogIn, LogOut, Settings } from "lucide-react";
import { useEffect, useState } from "react";
import { auth, fetchRevertStatus, type RevertStatus } from "../api.ts";
import { type AppTheme, useCanvas } from "../store.ts";
import { pushToast, toastError } from "../toast.ts";
import { RevertDialog } from "./RevertDialog.tsx";
import { Button } from "./ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu.tsx";

/**
 * Top-right account + settings. Shows who the folder is signed in to
 * velloo-cloud as — name, email, plan, and which cloud — with sign-in, sign-out,
 * the destructive revert-all action, and the app theme (Velloo's own chrome,
 * independent of the design's theme).
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

/** "api.velloo.ai" from a base URL — the whole URL is noise in a menu. */
function cloudLabel(cloudUrl: string | undefined): string {
  if (!cloudUrl) return "velloo-cloud";
  try {
    return new URL(cloudUrl).host;
  } catch {
    return cloudUrl;
  }
}

export function SettingsMenu() {
  const appTheme = useCanvas((s) => s.appTheme);
  const setAppTheme = useCanvas((s) => s.setAppTheme);
  const status = useCanvas((s) => s.authStatus);
  const setSignInOpen = useCanvas((s) => s.setSignInOpen);

  // Revert availability, refreshed each time the menu opens. Null while
  // unknown; the item hides entirely when the folder isn't in a git repo.
  const [revertStatus, setRevertStatus] = useState<RevertStatus | null>(null);
  const [revertConfirm, setRevertConfirm] = useState<RevertStatus | null>(null);
  // Fired, never subscribed: the action is reached through getState so this
  // stays a mount-only (and menu-open) refresh with no reactive dependencies.
  const refresh = () => {
    void useCanvas.getState().refreshAuth();
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
  const plan = account?.tier ? `${PLAN_LABEL[account.tier] ?? account.tier} plan` : null;
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
          <Button
            variant="outline"
            size="sm"
            className="max-w-[12rem] text-xs"
            title="Settings & account"
          >
            <Settings />
            <span className="truncate">{loggedIn && account ? account.email : "Settings"}</span>
          </Button>
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
            <div className="flex items-start gap-1.5 px-2 pb-1 text-[11px] text-destructive">
              <AlertTriangle size={12} className="mt-px shrink-0" />
              <span>This credential expired — sign in again.</span>
            </div>
          ) : null}
          <DropdownMenuSeparator />
          {loggedIn && !expired ? (
            <DropdownMenuItem onSelect={onLogout}>
              <LogOut />
              Log out
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={() => setSignInOpen(true)}>
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
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-[11px] font-normal text-muted-foreground">
            App theme
          </DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={appTheme}
            onValueChange={(v) => setAppTheme(v as AppTheme)}
          >
            <DropdownMenuRadioItem value="light">Light</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="dark">Dark</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="system">System</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
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
