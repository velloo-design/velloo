import { AlertTriangle, CircleCheck, Copy, ExternalLink, FileStack } from "lucide-react";
import type { PublishResult, PublishState } from "../../api.ts";
import { pushToast } from "../../toast.ts";
import { LoadingMark } from "../Loading.tsx";
import { planLabel } from "../SettingsMenu.tsx";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert.tsx";
import { Button } from "../ui/button.tsx";
import { Input } from "../ui/input.tsx";

type RunIn<S extends PublishState["state"]> = Extract<PublishState, { state: S }>;

/** A publish in flight — the daemon keeps going if the dialog closes. */
export function PublishRunning({ run }: { run: RunIn<"running"> }) {
  return (
    <div className="flex flex-col gap-3 py-4">
      <div className="flex items-center gap-2 text-sm">
        <LoadingMark size={16} />
        <span>{run.message}</span>
        {run.capture ? (
          <span className="text-muted-foreground tabular-nums">
            {run.capture.done}/{run.capture.total}
          </span>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">
        Capturing previews takes the longest. You can close this — the publish keeps going.
      </p>
      <Warnings messages={run.warnings} />
    </div>
  );
}

/** The finished link, what it asks of a visitor, and what went into it. */
export function PublishDone({
  run,
  upgradeUrl,
}: {
  run: RunIn<"done">;
  upgradeUrl: string | null;
}) {
  const { result } = run;
  return (
    <div className="flex flex-col gap-3 py-2">
      <div className="flex items-center gap-2 text-sm">
        <CircleCheck size={15} className="text-emerald-600 dark:text-emerald-500" />
        <span>{result.created ? "Published." : "Updated the existing link."}</span>
      </div>
      <div className="flex items-center gap-2">
        <Input readOnly value={result.shareUrl} className="font-mono text-xs" />
        <Button
          variant="outline"
          size="icon-sm"
          title="Copy link"
          onClick={() => void copyLink(result.shareUrl)}
        >
          <Copy />
        </Button>
        <Button variant="outline" size="icon-sm" title="Open link" asChild>
          <a href={result.shareUrl} target="_blank" rel="noreferrer">
            <ExternalLink />
          </a>
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{describeAccess(result)}</p>
      <p className="text-xs text-muted-foreground">
        {result.boards} board{result.boards === 1 ? "" : "s"} · {result.screens} screen
        {result.screens === 1 ? "" : "s"} · {result.files} files · {Math.round(result.bytes / 1024)}{" "}
        KB
        {result.screenshots > 0 ? ` · ${result.screenshots} previews` : ""}
      </p>
      <HistoryNote history={result.history} upgradeUrl={upgradeUrl} />
      <Warnings messages={run.warnings} />
    </div>
  );
}

/** A publish that didn't land — a full plan reads as a notice, not a fault. */
export function PublishFailed({
  run,
  upgradeUrl,
  onSeePublished,
  onSignIn,
}: {
  run: RunIn<"error">;
  upgradeUrl: string | null;
  onSeePublished(): void;
  onSignIn(): void;
}) {
  return (
    <div className="flex flex-col gap-3 py-2">
      {/* A full plan is not a fault, so it isn't dressed as one: the
          refusal used to arrive as red text quoting a status code, when
          what the user needed was the list of boards holding the slots. */}
      {run.boardLimit ? (
        <>
          <Alert role="note" data-testid="board-limit-notice">
            <FileStack />
            <AlertTitle>
              All {run.boardLimit.limit} board slots on the {planLabel(run.boardLimit.tier)} plan
              are in use
            </AlertTitle>
            <AlertDescription className="text-xs">
              Take one of your published boards down to free a slot, or upgrade for more.
              Re-publishing an existing link always works — the cap only counts new boards.
            </AlertDescription>
          </Alert>
          {/* Below the Alert, not in its action corner: `AlertAction`
              is absolutely positioned for one small button, and two
              crowd the title into a wrap. */}
          <div className="flex gap-2">
            <Button size="sm" onClick={onSeePublished}>
              See published boards
            </Button>
            {upgradeUrl && (
              <Button size="sm" variant="outline" asChild>
                <a href={upgradeUrl} target="_blank" rel="noreferrer">
                  Upgrade plan
                </a>
              </Button>
            )}
          </div>
        </>
      ) : (
        <div className="flex items-start gap-2 text-sm text-destructive">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>{run.message}</span>
        </div>
      )}
      {/* A token can be revoked during the minutes a capture pass takes.
          Losing that work to a dead end, with the fix one click away, is
          the worst version of this failure. */}
      {run.signInRequired ? (
        <Button onClick={onSignIn} className="self-start">
          Sign in and try again…
        </Button>
      ) : null}
      <Warnings messages={run.warnings} />
    </div>
  );
}

async function copyLink(url: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(url);
    pushToast({ kind: "success", message: "Share link copied." });
  } catch {
    pushToast({ kind: "info", message: url });
  }
}

/** What the published link now asks of a visitor, said plainly. */
function describeAccess(result: PublishResult): string {
  if (result.visibility === "private") {
    return result.passwordProtected
      ? "Your organization, or anyone with the password."
      : "Anyone signed in at your organization.";
  }
  return result.passwordProtected
    ? "Anyone with the link and the password."
    : "Anyone with the link.";
}

function Warnings({ messages }: { messages: string[] }) {
  if (messages.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1 rounded-md border bg-muted/40 p-2 text-[11px] text-muted-foreground">
      {messages.map((message) => (
        <li key={message}>{message}</li>
      ))}
    </ul>
  );
}

/**
 * What a re-publish did to previous versions. The share URL is stable, so a
 * free-plan publish silently replaces what viewers see — worth saying out loud.
 */
function HistoryNote({
  history,
  upgradeUrl,
}: {
  history?: { retained: boolean; versions: number; pruned: number } | undefined;
  upgradeUrl: string | null;
}) {
  if (!history) return null;
  if (!history.retained && history.pruned > 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Replaced the previous version — the free plan keeps only the latest.
        {upgradeUrl && (
          <>
            {" "}
            <a
              href={upgradeUrl}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-4"
            >
              Upgrade to keep history
            </a>
            .
          </>
        )}
      </p>
    );
  }
  if (history.retained && history.versions > 1) {
    return (
      <p className="text-xs text-muted-foreground">
        {history.versions} versions kept — earlier publishes stay pinnable.
      </p>
    );
  }
  return null;
}
