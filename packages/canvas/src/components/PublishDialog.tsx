import { AlertTriangle, CircleCheck, Copy, ExternalLink, LoaderCircle, Share2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  type PublishRequest,
  type PublishResult,
  type PublishState,
  type PublishTargets,
  publish,
} from "../api.ts";
import { useCanvas } from "../store.ts";
import { pushToast, toastError } from "../toast.ts";
import { Button } from "./ui/button.tsx";
import { Checkbox } from "./ui/checkbox.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog.tsx";
import { Input } from "./ui/input.tsx";
import { Label } from "./ui/label.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select.tsx";

/**
 * Publish boards to velloo-cloud as a share link.
 *
 * The work runs in the daemon (Tailwind, a screenshot pass, an upload), so this
 * starts a run and then polls it — the dialog can be closed and reopened
 * mid-publish without losing it. Everything a board carries into the cloud is
 * decided here: which boards, the link title, whether it's world-readable, and
 * — when the account's organization has more than one team — which team owns it.
 *
 * There is no workspace choice to make: an account belongs to at most one
 * organization (the cloud enforces that with a unique index on membership) and
 * publishing outside it is refused, so the only open question is the team.
 *
 * Opened from a single board's menu (`publishScope`) it skips the form
 * entirely and publishes that board on open, so the dialog is only ever showing
 * progress and the resulting link.
 */

/** Progress polling: fast enough that per-screenshot counters actually animate. */
const POLL_MS = 700;

export function PublishDialog() {
  const open = useCanvas((s) => s.publishOpen);
  const setOpen = useCanvas((s) => s.setPublishOpen);
  const setSignInOpen = useCanvas((s) => s.setSignInOpen);
  const design = useCanvas((s) => s.design);
  const scope = useCanvas((s) => s.publishScope);

  const [targets, setTargets] = useState<PublishTargets | null>(null);
  const [run, setRun] = useState<PublishState>({ state: "idle" });
  const [title, setTitle] = useState("");
  const [boardIds, setBoardIds] = useState<string[]>([]);
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  /** Never persisted anywhere: typed here, sent once, forgotten on close. */
  const [password, setPassword] = useState("");
  /** Null until the teams load, and stays null when there's nothing to choose. */
  const [teamId, setTeamId] = useState<string | null>(null);
  const [screenshots, setScreenshots] = useState(true);
  const [busy, setBusy] = useState(false);

  const boards = design?.boards ?? [];

  const startRun = useCallback(async (request: PublishRequest) => {
    setBusy(true);
    try {
      setRun(await publish.start(request));
    } catch (err) {
      toastError(err, "Could not start publishing");
    } finally {
      setBusy(false);
    }
  }, []);

  // Fresh form on open, and adopt whatever the daemon is already doing — a
  // publish started before the dialog was closed is still running.
  useEffect(() => {
    if (!open) return;
    setTitle(scope ? scope.name : design?.folderName ? `${design.folderName} designs` : "");
    setBoardIds(scope ? [scope.id] : (design?.boards ?? []).map((b) => b.id));
    setVisibility("public");
    setPassword("");
    setTeamId(null);
    setScreenshots(true);
    setBusy(false);

    let cancelled = false;
    void (async () => {
      const [found, state] = await Promise.all([
        publish.targets().catch(() => ({ ready: false, teams: [] }) as PublishTargets),
        publish.status().catch(() => ({ state: "idle" }) as PublishState),
      ]);
      if (cancelled) return;
      setTargets(found);
      // Only offer a choice when there is one; a lone team is where the cloud
      // would put the publish anyway, so it needs no control and no request field.
      if (found.teams.length > 1) {
        setTeamId((found.teams.find((team) => team.isDefault) ?? found.teams[0])?.id ?? null);
      }
      // A settled run from last time would show as a result over a form the
      // user came here to fill in — clear it and start clean.
      let current = state;
      if (state.state === "done" || state.state === "error") {
        await publish.reset().catch(() => undefined);
        if (cancelled) return;
        current = { state: "idle" };
      }
      setRun(current);
      // Straight from a board's menu: there's nothing to fill in, so publish it.
      // Signed out, or already busy with another run, and we just show that.
      if (scope && found.ready && current.state === "idle") {
        await startRun({
          boardIds: [scope.id],
          title: scope.name,
          visibility: "public",
          screenshots: true,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, design?.folderName, design?.boards, scope, startRun]);

  // Poll while the daemon is working.
  useEffect(() => {
    if (!open || run.state !== "running") return;
    const timer = setInterval(() => {
      void publish
        .status()
        .then(setRun)
        .catch(() => undefined);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [open, run.state]);

  const start = () =>
    startRun({
      boardIds,
      ...(title.trim() ? { title: title.trim() } : {}),
      visibility,
      ...(password.length >= 8 ? { password } : {}),
      ...(teamId ? { teamId } : {}),
      screenshots,
    });

  const toggleBoard = (id: string, on: boolean) => {
    setBoardIds((ids) => (on ? [...new Set([...ids, id])] : ids.filter((x) => x !== id)));
  };

  const copyLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      pushToast({ kind: "success", message: "Share link copied." });
    } catch {
      pushToast({ kind: "info", message: url });
    }
  };

  const signedOut = targets !== null && !targets.ready;
  const unavailable = run.state === "unavailable";
  // No boards is legitimate — a board-less folder publishes all its screens.
  const nothingSelected = boards.length > 0 && boardIds.length === 0;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && setOpen(false)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Publish to velloo-cloud</DialogTitle>
          <DialogDescription>
            {scope
              ? `Sharing “${scope.name}” as a commentable link.`
              : "Share a rendered, commentable copy of these boards by link."}
          </DialogDescription>
        </DialogHeader>

        {unavailable ? (
          <p className="py-4 text-sm text-muted-foreground">
            This canvas isn't running through the velloo CLI, so it has no account to publish with.
          </p>
        ) : signedOut ? (
          <div className="flex flex-col gap-3 py-2">
            <p className="text-sm text-muted-foreground">
              Publishing needs a velloo-cloud account.
            </p>
            <Button
              onClick={() => {
                setOpen(false);
                setSignInOpen(true);
              }}
              className="self-start"
            >
              Sign in…
            </Button>
          </div>
        ) : run.state === "running" ? (
          <div className="flex flex-col gap-3 py-4">
            <div className="flex items-center gap-2 text-sm">
              <LoaderCircle className="animate-spin" size={14} />
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
        ) : run.state === "done" ? (
          <div className="flex flex-col gap-3 py-2">
            <div className="flex items-center gap-2 text-sm">
              <CircleCheck size={15} className="text-emerald-600 dark:text-emerald-500" />
              <span>{run.result.created ? "Published." : "Updated the existing link."}</span>
            </div>
            <div className="flex items-center gap-2">
              <Input readOnly value={run.result.shareUrl} className="font-mono text-xs" />
              <Button
                variant="outline"
                size="icon-sm"
                title="Copy link"
                onClick={() => void copyLink(run.result.shareUrl)}
              >
                <Copy />
              </Button>
              <Button variant="outline" size="icon-sm" title="Open link" asChild>
                <a href={run.result.shareUrl} target="_blank" rel="noreferrer">
                  <ExternalLink />
                </a>
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{describeAccess(run.result)}</p>
            <p className="text-xs text-muted-foreground">
              {run.result.boards} board{run.result.boards === 1 ? "" : "s"} · {run.result.screens}{" "}
              screen{run.result.screens === 1 ? "" : "s"} · {run.result.files} files ·{" "}
              {Math.round(run.result.bytes / 1024)} KB
              {run.result.screenshots > 0 ? ` · ${run.result.screenshots} previews` : ""}
            </p>
            <HistoryNote history={run.result.history} />
            <Warnings messages={run.warnings} />
          </div>
        ) : run.state === "error" ? (
          <div className="flex flex-col gap-3 py-2">
            <div className="flex items-start gap-2 text-sm text-destructive">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>{run.message}</span>
            </div>
            <Warnings messages={run.warnings} />
          </div>
        ) : (
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="publish-title">Title</Label>
              <Input
                id="publish-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Board title"
              />
            </div>

            {boards.length > 0 ? (
              <div className="grid gap-2">
                <Label>Boards</Label>
                <div className="max-h-40 overflow-y-auto rounded-md border">
                  {boards.map((board) => (
                    <div
                      key={board.id}
                      className="flex items-center gap-2 px-2.5 py-1.5 text-sm hover:bg-accent/50"
                    >
                      <Checkbox
                        id={`publish-board-${board.id}`}
                        checked={boardIds.includes(board.id)}
                        onCheckedChange={(v) => toggleBoard(board.id, v === true)}
                      />
                      <Label
                        htmlFor={`publish-board-${board.id}`}
                        className="flex-1 cursor-pointer truncate font-normal"
                      >
                        {board.name}
                      </Label>
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        {board.frameCount} frame{board.frameCount === 1 ? "" : "s"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                This folder has no boards, so every screen is published.
              </p>
            )}

            <div className="grid gap-2">
              <Label htmlFor="publish-visibility">Visibility</Label>
              <Select
                value={visibility}
                onValueChange={(v) => setVisibility(v as "public" | "private")}
              >
                <SelectTrigger id="publish-visibility">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="public">Anyone with the link</SelectItem>
                  <SelectItem value="private">Only your organization</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="publish-password">Password (optional)</Label>
              <Input
                id="publish-password"
                type="password"
                autoComplete="new-password"
                placeholder="8+ characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <p className="text-[11px] text-muted-foreground">
                Anyone with the password can view, signed in or not. Send it separately from the
                link.
              </p>
            </div>

            {targets && targets.teams.length > 1 && teamId ? (
              <div className="grid gap-2">
                <Label htmlFor="publish-team">Team</Label>
                <Select value={teamId} onValueChange={setTeamId}>
                  <SelectTrigger id="publish-team">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {targets.teams.map((team) => (
                      <SelectItem key={team.id} value={team.id}>
                        {team.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            <div className="flex items-center gap-2">
              <Checkbox
                id="publish-screenshots"
                checked={screenshots}
                onCheckedChange={(v) => setScreenshots(v === true)}
              />
              <Label htmlFor="publish-screenshots" className="cursor-pointer font-normal">
                Capture preview images
              </Label>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            {run.state === "done" ? "Done" : "Close"}
          </Button>
          {run.state === "idle" && !signedOut && !unavailable ? (
            <Button onClick={() => void start()} disabled={busy || nothingSelected}>
              <Share2 />
              {busy ? "Starting…" : "Publish"}
            </Button>
          ) : null}
          {run.state === "error" ? (
            <Button onClick={() => setRun({ state: "idle" })}>Back</Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Non-fatal notes from the run — a dropped screenshot, a missing asset, a new folderId. */
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
}: {
  history?: { retained: boolean; versions: number; pruned: number };
}) {
  if (!history) return null;
  if (!history.retained && history.pruned > 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Replaced the previous version — the free plan keeps only the latest.{" "}
        <a
          href="https://velloo.ai/pricing"
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-4"
        >
          Upgrade to keep history
        </a>
        .
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
