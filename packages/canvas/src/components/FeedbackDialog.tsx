import { Bug, LogIn, MessageSquare } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { type FeedbackKind, sendFeedback } from "../api.ts";
import { useCanvas } from "../store.ts";
import { pushToast, toastError } from "../toast.ts";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert.tsx";
import { Button } from "./ui/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog.tsx";
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel } from "./ui/field.tsx";
import { Spinner } from "./ui/spinner.tsx";
import { Switch } from "./ui/switch.tsx";
import { Textarea } from "./ui/textarea.tsx";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group.tsx";

/** The daemon's cap, which is the cloud's. */
const FEEDBACK_MAX_CHARS = 6000;

const PLACEHOLDER: Record<FeedbackKind, string> = {
  bug: "What happened, and what did you expect instead? Steps to reproduce help most.",
  feedback: "What's working, what isn't, what you wish velloo did…",
};

/**
 * The user's own line to the velloo team — the human counterpart of the
 * agent's `send_feedback` tool, and anonymous by default for the same reason:
 * a blind-signed token proves "a velloo user" without saying which one.
 *
 * Both ways of sending need a signed-in session (the anonymous one mints its
 * token over it), so a signed-out user gets the draft *and* the sign-in in
 * one place: the text they typed survives the round trip through the sign-in
 * dialog, and Send lights up as soon as the account is back.
 *
 * The two dialogs take turns rather than stack: this one steps aside while
 * the sign-in is up — whether the gate's button or a session that ended
 * mid-send asked for it — and comes back when it closes. The draft lives in
 * this component, which stays mounted, so nothing typed is lost.
 */
export function FeedbackDialog() {
  const open = useCanvas((s) => s.feedbackOpen);
  const setOpen = useCanvas((s) => s.setFeedbackOpen);
  const status = useCanvas((s) => s.authStatus);
  const openSignIn = useCanvas((s) => s.openSignIn);
  const signInPrompt = useCanvas((s) => s.signInPrompt);
  const resumeAfterSignIn = useRef(false);
  const [kind, setKind] = useState<FeedbackKind>("bug");
  const [body, setBody] = useState("");
  const [anonymous, setAnonymous] = useState(true);
  const [sending, setSending] = useState(false);
  const bodyId = useId();
  const anonymousId = useId();

  useEffect(() => {
    if (open) void useCanvas.getState().refreshAuth();
  }, [open]);

  useEffect(() => {
    const { feedbackOpen, setFeedbackOpen } = useCanvas.getState();
    if (signInPrompt && feedbackOpen) {
      resumeAfterSignIn.current = true;
      setFeedbackOpen(false);
    } else if (!signInPrompt && resumeAfterSignIn.current) {
      resumeAfterSignIn.current = false;
      setFeedbackOpen(true);
    }
  }, [signInPrompt]);

  const expired = Boolean(status?.loggedIn) && status?.verified === false;
  const signedIn = Boolean(status?.loggedIn) && !expired;
  const email = status?.account?.email;
  const trimmed = body.trim();
  const canSend = signedIn && trimmed.length > 0 && !sending;

  const send = async () => {
    if (!canSend) return;
    setSending(true);
    try {
      const message = await sendFeedback({ kind, body: trimmed, anonymous });
      pushToast({ kind: "success", message });
      setBody("");
      setOpen(false);
    } catch (error) {
      toastError(
        error,
        kind === "bug" ? "Could not send the bug report" : "Could not send feedback",
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !sending && setOpen(next)}>
      <DialogContent className="sm:max-w-md" data-testid="feedback-dialog">
        <DialogHeader>
          <DialogTitle>Report a bug or send feedback</DialogTitle>
          <DialogDescription>
            Goes straight to the velloo team. Leave out anything confidential — nothing from your
            designs is attached.
          </DialogDescription>
        </DialogHeader>
        {!signedIn ? (
          <Alert data-testid="feedback-sign-in">
            <LogIn />
            <AlertTitle>{expired ? "Sign in again to send" : "Sign in to send"}</AlertTitle>
            <AlertDescription>
              <p>
                Feedback needs a velloo cloud account — even anonymous feedback, which is vouched
                for by your sign-in without naming you.
              </p>
              <Button
                size="sm"
                variant="outline"
                className="mt-2"
                onClick={() =>
                  openSignIn({ action: "send your feedback", ...(expired && { expired: true }) })
                }
              >
                {expired ? "Sign in again…" : "Sign in to velloo cloud…"}
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <FieldGroup className="gap-4">
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              spacing={0}
              value={kind}
              // Pressing the active item clears a Radix toggle; a report is
              // always one of the two, so that press is ignored.
              onValueChange={(value) => value && setKind(value as FeedbackKind)}
              className="w-full"
              aria-label="What are you sending?"
            >
              <ToggleGroupItem value="bug" className="flex-1" data-testid="feedback-kind-bug">
                <Bug /> Bug
              </ToggleGroupItem>
              <ToggleGroupItem
                value="feedback"
                className="flex-1"
                data-testid="feedback-kind-feedback"
              >
                <MessageSquare /> Feedback
              </ToggleGroupItem>
            </ToggleGroup>
            <Field>
              <FieldLabel htmlFor={bodyId} className="sr-only">
                {kind === "bug" ? "Describe the bug" : "Your feedback"}
              </FieldLabel>
              <Textarea
                id={bodyId}
                value={body}
                onChange={(event) => setBody(event.target.value)}
                maxLength={FEEDBACK_MAX_CHARS}
                placeholder={PLACEHOLDER[kind]}
                className="min-h-32"
                autoFocus
              />
              <FieldDescription className="text-right text-[11px] tabular-nums">
                {body.length.toLocaleString()} / {FEEDBACK_MAX_CHARS.toLocaleString()}
              </FieldDescription>
            </Field>
            <Field orientation="horizontal">
              <FieldContent>
                <FieldLabel htmlFor={anonymousId}>Send anonymously</FieldLabel>
                <FieldDescription data-testid="feedback-anonymous-help">
                  {anonymous
                    ? "Anonymous feedback can't be linked to your account, so we can't reply to it."
                    : `Sent from your account${email ? ` (${email})` : ""}, so we can follow up with you.`}
                </FieldDescription>
              </FieldContent>
              <Switch
                id={anonymousId}
                checked={anonymous}
                onCheckedChange={setAnonymous}
                data-testid="feedback-anonymous"
              />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={sending}
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!canSend} data-testid="feedback-send">
              {sending ? <Spinner /> : null}
              {sending ? "Sending…" : "Send"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
