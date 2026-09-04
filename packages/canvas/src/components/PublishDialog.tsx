import { AlertTriangle, CircleCheck, Copy, ExternalLink, Eye, EyeOff, Share2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type PublishRequest,
  type PublishResult,
  type PublishState,
  type PublishTargets,
  publish,
} from "../api.ts";
import { useCanvas } from "../store.ts";
import { pushToast, toastError } from "../toast.ts";
import { LoadingMark } from "./Loading.tsx";
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
 * A board-menu publish pre-fills board/access choices but still stops here: the
 * destination must never be inferred merely because the menu was a shortcut.
 */

/** Progress polling: fast enough that per-screenshot counters actually animate. */
const POLL_MS = 700;

export function PublishDialog() {
  const open = useCanvas((s) => s.publishOpen);
  const setOpen = useCanvas((s) => s.setPublishOpen);
  const openSignIn = useCanvas((s) => s.openSignIn);
  const design = useCanvas((s) => s.design);
  const scope = useCanvas((s) => s.publishScope);

  const [targets, setTargets] = useState<PublishTargets | null>(null);
  const [run, setRun] = useState<PublishState>({ state: "idle" });
  const [title, setTitle] = useState("");
  const [boardIds, setBoardIds] = useState<string[]>([]);
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  /** Never persisted anywhere: typed here, sent once, forgotten on close. */
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  /** Null until the teams load, and stays null when there's nothing to choose. */
  const [teamId, setTeamId] = useState<string | null>(null);
  const [screenshots, setScreenshots] = useState(true);
  const [destinationSlug, setDestinationSlug] = useState("new");
  const [destinationTouched, setDestinationTouched] = useState(false);
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
    setVisibility(scope?.mode === "private" ? "private" : "public");
    setPassword("");
    setShowPassword(false);
    setTeamId(null);
    setScreenshots(true);
    setDestinationSlug("new");
    setDestinationTouched(false);
    setBusy(false);

    let cancelled = false;
    void (async () => {
      const [found, state] = await Promise.all([
        publish.targets().catch(() => ({ ready: false, teams: [], slots: [] }) as PublishTargets),
        publish.status().catch(() => ({ state: "idle" }) as PublishState),
      ]);
      if (cancelled) return;
      setTargets(found);
      // Only offer a choice when there is one; a lone team is where the cloud
      // would put the publish anyway, so it needs no control and no request field.
      setTeamId(
        found.effectiveTeamId ??
          (found.teams.find((team) => team.isDefault) ?? found.teams[0])?.id ??
          null,
      );
      // A settled run from last time would show as a result over a form the
      // user came here to fill in — clear it and start clean.
      let current = state;
      if (state.state === "done" || state.state === "error") {
        await publish.reset().catch(() => undefined);
        if (cancelled) return;
        current = { state: "idle" };
      }
      setRun(current);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, design?.folderName, design?.boards, scope]);

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

  const effectiveTeamId = teamId ?? targets?.effectiveTeamId ?? null;
  const currentSource = useMemo(
    () => ({
      boardIds,
      teamId: effectiveTeamId,
      repo: targets?.provenance?.repo ?? null,
      branch: targets?.provenance?.branch ?? null,
    }),
    [boardIds, effectiveTeamId, targets?.provenance],
  );
  const matchingSlots = useMemo(() => {
    const latest = canvasLatestMatchingSlot(targets?.slots ?? [], currentSource);
    return latest ? [latest] : [];
  }, [targets?.slots, currentSource]);
  const selectedSlot = matchingSlots.find((slot) => slot.slug === destinationSlug) ?? null;
  const recommendedSlug = useMemo(() => {
    return matchingSlots[0]?.slug ?? "new";
  }, [matchingSlots]);

  useEffect(() => {
    if (!destinationTouched) setDestinationSlug(recommendedSlug);
  }, [destinationTouched, recommendedSlug]);

  useEffect(() => {
    if (destinationSlug !== "new" && !matchingSlots.some((slot) => slot.slug === destinationSlug)) {
      setDestinationTouched(false);
      setDestinationSlug(recommendedSlug);
    }
  }, [destinationSlug, matchingSlots, recommendedSlug]);

  const start = () => {
    const destination: PublishRequest["destination"] = selectedSlot
      ? {
          mode: "update",
          slug: selectedSlot.slug,
          expectedVersionId: selectedSlot.latestVersionId,
        }
      : { mode: "new" };
    return startRun({
      boardIds,
      ...(title.trim() ? { title: title.trim() } : {}),
      visibility,
      ...(password.length >= 3 ? { password } : {}),
      ...(teamId ? { teamId } : {}),
      destination,
      screenshots,
    });
  };

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

  // `access` names *why* publishing is closed; `ready` is the fallback for a
  // daemon too old to send it, where the only knowable reason is no credential.
  const access =
    targets === null ? null : (targets.access ?? (targets.ready ? "ready" : "signed-out"));
  const signedOut = access !== null && access !== "ready";
  const expired = access === "expired";
  const unavailable = run.state === "unavailable";
  // No boards is legitimate — a board-less folder publishes all its screens.
  const nothingSelected = boards.length > 0 && boardIds.length === 0;
  const passwordMissing = scope?.mode === "password" && password.length < 3;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && setOpen(false)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Publish to velloo-cloud</DialogTitle>
          <DialogDescription>
            {scope
              ? `Sharing “${scope.name}” ${scope.mode === "private" ? "privately" : scope.mode === "password" ? "with password protection" : "publicly"}.`
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
              {expired
                ? "Your velloo-cloud session has ended. Sign in again to publish these boards."
                : "Publishing needs a velloo-cloud account."}
            </p>
            <Button
              onClick={() => {
                setOpen(false);
                openSignIn({ action: "publish these boards", ...(expired ? { expired } : {}) });
              }}
              className="self-start"
            >
              {expired ? "Sign in again…" : "Sign in…"}
            </Button>
          </div>
        ) : run.state === "running" ? (
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
            {/* A token can be revoked during the minutes a capture pass takes.
                Losing that work to a dead end, with the fix one click away, is
                the worst version of this failure. */}
            {run.signInRequired ? (
              <Button
                onClick={() => {
                  setOpen(false);
                  openSignIn({
                    action: "publish these boards",
                    expired: run.signInRequired === "expired",
                  });
                }}
                className="self-start"
              >
                Sign in and try again…
              </Button>
            ) : null}
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
              <Label htmlFor="publish-destination">Destination</Label>
              <Select
                value={destinationSlug}
                onValueChange={(value) => {
                  setDestinationTouched(true);
                  setDestinationSlug(value);
                }}
                disabled={Boolean(targets?.destinationError)}
              >
                <SelectTrigger id="publish-destination">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {matchingSlots.map((slot) => (
                    <SelectItem key={slot.slug} value={slot.slug}>
                      Update {slot.title || "Untitled design"}
                    </SelectItem>
                  ))}
                  <SelectItem value="new">Create a new link</SelectItem>
                </SelectContent>
              </Select>
              {targets?.destinationError ? (
                <p className="text-xs text-destructive">{targets.destinationError}</p>
              ) : selectedSlot ? (
                <p className="text-[11px] text-muted-foreground">
                  Matches this team, board selection, and source.
                </p>
              ) : (
                <p className="text-[11px] text-muted-foreground">
                  Creates a separate live URL and keeps existing review links unchanged.
                </p>
              )}
            </div>

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
              <Label htmlFor="publish-password">
                Password{scope?.mode === "password" ? "" : " (optional)"}
              </Label>
              <div className="relative">
                <Input
                  id="publish-password"
                  className="pr-10"
                  type={showPassword ? "text" : "password"}
                  minLength={3}
                  autoComplete="new-password"
                  placeholder="3+ characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <Button
                  type="button"
                  variant="ghost"
                  className="absolute right-0 top-0 h-9 w-9 p-0"
                  onClick={() => setShowPassword((value) => !value)}
                  title={showPassword ? "Hide password" : "Show password"}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                >
                  {showPassword ? <EyeOff /> : <Eye />}
                </Button>
              </div>
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
            <Button
              onClick={() => void start()}
              disabled={
                busy || nothingSelected || passwordMissing || Boolean(targets?.destinationError)
              }
            >
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

export function canvasSlotMismatches(
  slot: PublishTargets["slots"][number],
  current: {
    boardIds: string[];
    teamId: string | null;
    repo: string | null;
    branch: string | null;
  },
): string[] {
  const mismatches: string[] = [];
  if (!slot.context.contextKnown) mismatches.push("board context is unknown");
  if (slot.teamId !== current.teamId) mismatches.push("team differs");
  const sorted = (ids: string[]) => [...new Set(ids)].sort();
  if (JSON.stringify(sorted(slot.context.boardIds)) !== JSON.stringify(sorted(current.boardIds))) {
    mismatches.push("board selection differs");
  }
  if (slot.context.repo !== current.repo) {
    mismatches.push("repository differs");
  } else if (current.repo !== null) {
    if (!slot.context.branch || !current.branch) mismatches.push("branch is unavailable");
    else if (slot.context.branch !== current.branch) mismatches.push("branch differs");
  }
  return mismatches;
}

export function canvasMatchingSlots(
  slots: PublishTargets["slots"],
  current: Parameters<typeof canvasSlotMismatches>[1],
): PublishTargets["slots"] {
  return slots.filter((slot) => canvasSlotMismatches(slot, current).length === 0);
}

export function canvasLatestMatchingSlot(
  slots: PublishTargets["slots"],
  current: Parameters<typeof canvasSlotMismatches>[1],
): PublishTargets["slots"][number] | null {
  return (
    canvasMatchingSlots(slots, current).sort(
      (left, right) =>
        canvasPublishedAt(right.lastPublishedAt) - canvasPublishedAt(left.lastPublishedAt),
    )[0] ?? null
  );
}

const canvasPublishedAt = (value: string | null): number => {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
};

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
  history?: { retained: boolean; versions: number; pruned: number } | undefined;
}) {
  if (!history) return null;
  if (!history.retained && history.pruned > 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Replaced the previous version — the free plan keeps only the latest.{" "}
        <a
          href="https://velloo.design/pricing"
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
