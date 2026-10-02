import { Settings } from "lucide-react";
import type * as React from "react";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback } from "./ui/avatar.tsx";
import { Button } from "./ui/button.tsx";

/**
 * Who is signed in, as far as the trigger needs: a name when the cloud has one
 * on file, an email otherwise. The share viewer's comment identity carries a
 * name and no email, so either may be missing.
 */
export interface AccountIdentity {
  name?: string | null | undefined;
  email?: string | null | undefined;
}

/**
 * The name to greet someone by. First name only — the whole point of the
 * signed-in trigger is that it reads like a person, not a database row — with
 * the email's local part as the fallback when the cloud has no name on file.
 */
export function firstName(account: AccountIdentity): string {
  const given = account.name?.trim().split(/\s+/)[0];
  if (given) return given;
  const email = account.email ?? "";
  return email.split("@")[0] || email;
}

/** Up to two initials for the avatar: given + family, else the email's first two. */
export function initials(account: AccountIdentity): string {
  const parts = account.name?.trim().split(/\s+/).filter(Boolean) ?? [];
  if (parts.length >= 2)
    return `${parts[0]?.[0] ?? ""}${parts[parts.length - 1]?.[0] ?? ""}`.toUpperCase();
  const source = parts[0] ?? account.email ?? "";
  return source.slice(0, 2).toUpperCase();
}

/**
 * The top bar's account control, shared by the canvas and velloo-cloud's share
 * viewer so the two read the same: signed in, the person's avatar and first
 * name; signed out, a plain Settings button. Props pass through to the button,
 * so either menu can make it its trigger.
 */
export function AccountTrigger({
  account,
  expired = false,
  compact = false,
  badge,
  className,
  ...props
}: React.ComponentProps<typeof Button> & {
  /** Null when nobody is signed in. */
  account: AccountIdentity | null;
  /** A credential the cloud rejected: the person stays, muted. */
  expired?: boolean | undefined;
  /** Hide the label, for a phone's crowded header. */
  compact?: boolean | undefined;
  /** A mark over the trigger, such as an update dot. */
  badge?: React.ReactNode;
}) {
  if (account) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className={cn("relative max-w-[12rem] gap-2 pl-1 pr-2.5 text-xs", className)}
        title={`${account.email ?? firstName(account)} — account & settings`}
        {...props}
      >
        <Avatar aria-hidden="true" className="size-6">
          <AvatarFallback
            className={
              // An expired credential still shows the person, muted — the
              // menu explains why, and a red avatar would read as an error
              // with their identity rather than with the token.
              "text-[10px] font-semibold " +
              (expired ? "bg-muted text-muted-foreground" : "bg-primary text-primary-foreground")
            }
          >
            {initials(account)}
          </AvatarFallback>
        </Avatar>
        <span className={compact ? "sr-only" : "truncate"}>{firstName(account)}</span>
        {badge}
      </Button>
    );
  }
  return (
    <Button
      variant="outline"
      size="sm"
      className={cn("relative max-w-[12rem] text-xs", className)}
      title="Settings & account"
      {...props}
    >
      <Settings />
      <span className={compact ? "sr-only" : "truncate"}>Settings</span>
      {badge}
    </Button>
  );
}
