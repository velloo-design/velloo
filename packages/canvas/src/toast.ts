/**
 * Thin wrapper around Sonner's imperative API. Keeps the existing
 * `pushToast` / `toastError` callsites stable while delegating to
 * Sonner's queue + portal + animation.
 *
 * The actual `<Toaster />` is mounted once at the root of `App.tsx`
 * from `./components/ui/sonner`.
 */
import { toast as sonner } from "sonner";
import { isSignInRequired } from "./api/errors.ts";
import { askToSignIn } from "./api/sign-in-gate.ts";

export type ToastKind = "info" | "success" | "error";

export function pushToast(input: {
  kind?: ToastKind;
  title?: string;
  message: string;
  ttl?: number;
  /** A one-click way out, for a toast that reports something fixable. */
  action?: { label: string; onClick: () => void };
}): string {
  const kind = input.kind ?? "info";
  const duration = input.ttl ?? (kind === "error" ? 6000 : 3500);
  const message = input.title ?? input.message;
  const description = input.title ? input.message : undefined;
  const opts = { description, duration, action: input.action } as const;

  let id: string | number;
  if (kind === "success") {
    id = sonner.success(message, opts);
  } else if (kind === "error") {
    id = sonner.error(message, opts);
  } else {
    id = sonner(message, opts);
  }
  return String(id);
}

/**
 * Report a failed action.
 *
 * Every call site here is something the user just did, which is why a failure
 * the credential explains opens the sign-in dialog instead of a toast: the
 * message would otherwise say "sign in again" while offering no way to. The
 * returned id is empty in that case — there is no toast to dismiss.
 */
export function toastError(err: unknown, fallback: string): string {
  // No `expired` flag: from here the two cases (no credential, rejected
  // credential) are indistinguishable, and the dialog's neutral wording is
  // true of both. Call sites that know which it is say so themselves.
  if (isSignInRequired(err)) {
    askToSignIn();
    return "";
  }
  const msg = err instanceof Error ? err.message : typeof err === "string" ? err : fallback;
  return pushToast({ kind: "error", message: msg || fallback });
}
