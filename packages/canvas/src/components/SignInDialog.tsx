import { AlertTriangle, ExternalLink, LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { type AuthStatus, auth, type LoginState, loginAttemptSucceeded } from "../api.ts";
import { useCanvas } from "../store.ts";
import { pushToast } from "../toast.ts";
import { Button } from "./ui/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog.tsx";

/**
 * Sign in to velloo-cloud without leaving the canvas.
 *
 * This is the OAuth device flow, so it can't complete in one call: the daemon
 * hands back a short code, the user approves it in a browser tab (which the
 * daemon opens for them), and we poll until the credential lands. The code stays
 * on screen the whole time because the automatic tab is a convenience, not a
 * guarantee — a headless box, a stolen focus, or the wrong default browser all
 * leave the printed code as the only way through.
 */

/** Fast enough to feel immediate after the browser approval, cheap enough to poll. */
const POLL_MS = 1500;

export function SignInDialog() {
  const open = useCanvas((s) => s.signInOpen);
  const setOpen = useCanvas((s) => s.setSignInOpen);
  const refreshAuth = useCanvas((s) => s.refreshAuth);

  const [login, setLogin] = useState<LoginState>({ state: "idle" });
  const [starting, setStarting] = useState(false);
  /** Teardown for the attempt in flight, so a retry or a close cancels it. */
  const attempt = useRef<(() => void) | null>(null);

  // One attempt = start, then poll until it settles. Nothing lands on a
  // superseded attempt: every path checks the `live` flag it captured.
  const begin = useCallback(() => {
    attempt.current?.();
    let live = true;
    let timer: ReturnType<typeof setInterval> | undefined;
    const stop = () => {
      live = false;
      if (timer) clearInterval(timer);
    };
    attempt.current = stop;

    const succeed = (status: AuthStatus) => {
      stop();
      void refreshAuth();
      pushToast({
        kind: "success",
        message: status.account?.email
          ? `Signed in as ${status.account.email}.`
          : "Signed in to velloo-cloud.",
      });
      setOpen(false);
    };

    void (async () => {
      setStarting(true);
      let status: AuthStatus;
      try {
        status = await auth.login();
      } catch (err) {
        if (!live) return;
        setStarting(false);
        setLogin({
          state: "error",
          message: err instanceof Error ? err.message : "Could not start sign-in.",
        });
        return;
      }
      if (!live) return;
      setStarting(false);
      setLogin(status.login);
      // An old expired credential can coexist with the replacement flow. Only
      // the attempt leaving `pending` proves the browser approval has landed.
      if (loginAttemptSucceeded(status)) {
        succeed(status);
        return;
      }
      if (status.login.state !== "pending") return;

      timer = setInterval(() => {
        void auth.status().then((next) => {
          if (!live) return;
          if (loginAttemptSucceeded(next)) {
            succeed(next);
            return;
          }
          setLogin(next.login);
          // The daemon gave up (expired code, cloud trouble) — stop asking.
          if (next.login.state !== "pending") stop();
        });
      }, POLL_MS);
    })();
  }, [refreshAuth, setOpen]);

  useEffect(() => {
    if (!open) {
      attempt.current?.();
      attempt.current = null;
      setLogin({ state: "idle" });
      setStarting(false);
      return;
    }
    begin();
    return () => {
      attempt.current?.();
      attempt.current = null;
    };
  }, [open, begin]);

  const close = () => {
    setOpen(false);
    // Abandon a half-finished device code rather than leaving the daemon
    // polling the issuer for a sign-in nobody is waiting on.
    if (login.state === "pending") void auth.cancelLogin().catch(() => undefined);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Sign in to velloo-cloud</DialogTitle>
          <DialogDescription>
            Publishing boards and pulling share-link comments need an account.
          </DialogDescription>
        </DialogHeader>

        {starting || login.state === "idle" ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <LoaderCircle className="animate-spin" size={14} />
            Starting sign-in…
          </div>
        ) : null}

        {login.state === "pending" ? (
          <div className="flex flex-col gap-4 py-2">
            <div className="flex flex-col items-center gap-2 rounded-md border bg-muted/40 py-4">
              <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Your code
              </span>
              <span className="font-mono text-2xl tracking-[0.2em] tabular-nums">
                {login.userCode}
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              A browser tab should have opened. Enter the code there to finish signing in — this
              dialog closes itself once it lands.
            </p>
            <a
              href={login.verificationUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-sm underline underline-offset-4"
            >
              <ExternalLink size={13} />
              Open the sign-in page
            </a>
          </div>
        ) : null}

        {login.state === "error" ? (
          <div className="flex items-start gap-2 py-2 text-sm text-destructive">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span>{login.message}</span>
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={close}>
            {login.state === "pending" ? "Cancel" : "Close"}
          </Button>
          {login.state === "error" ? <Button onClick={begin}>Try again</Button> : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
