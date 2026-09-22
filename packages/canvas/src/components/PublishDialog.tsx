import { protectedSharesAllowed } from "@velloo/protocol";
import { Share2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { preflightBoards, type ScreenRenderFailure } from "../api/preflight.ts";
import { type PublishRequest, type PublishState, type PublishTargets, publish } from "../api.ts";
import { useCanvas } from "../store.ts";
import { toastError } from "../toast.ts";
import { PublishForm } from "./Publish/PublishForm.tsx";
import { PublishDone, PublishFailed, PublishRunning } from "./Publish/PublishOutcome.tsx";
import { canvasLatestMatchingSlot } from "./Publish/slot-matching.ts";
import { RenderFailureDialog } from "./RenderFailureDialog.tsx";
import { billingUrl } from "./SettingsMenu.tsx";
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
  const openPublishedBoards = useCanvas((s) => s.setPublishedBoardsOpen);
  const settlePublish = useCanvas((s) => s.settlePublish);
  const design = useCanvas((s) => s.design);
  const scope = useCanvas((s) => s.publishScope);
  /**
   * A free plan publishes public links only. The form says so — visibility
   * read-only, the protected modes offered as an upgrade — rather than letting
   * the choice fail after the upload.
   */
  const protectedShares = useCanvas((s) => protectedSharesAllowed(s.authStatus?.account?.tier));
  /**
   * The cloud's own billing page (local, dev or prod) — which plan unlocks
   * what, and what it costs, is that page's job to say. Null when the cloud
   * advertised no app URL we can trust, and the upsells then drop the link
   * rather than sending anyone somewhere invented.
   */
  const upgradeUrl = useCanvas((s) => billingUrl(s.authStatus?.appUrl));

  const [targets, setTargets] = useState<PublishTargets | null>(null);
  const [run, setRun] = useState<PublishState>({ state: "idle" });
  const [title, setTitle] = useState("");
  const [boardIds, setBoardIds] = useState<string[]>([]);
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  /** Never persisted anywhere: typed here, sent once, forgotten on close. */
  const [password, setPassword] = useState("");
  /** Null until the teams load, and stays null when there's nothing to choose. */
  const [teamId, setTeamId] = useState<string | null>(null);
  const [destinationSlug, setDestinationSlug] = useState("new");
  const [destinationTouched, setDestinationTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failures, setFailures] = useState<ScreenRenderFailure[] | null>(null);

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
    setTitle(scope ? scope.name : design?.designName ? `${design.designName} designs` : "");
    setBoardIds(scope ? [scope.id] : (design?.boards ?? []).map((b) => b.id));
    setVisibility(scope?.mode === "private" ? "private" : "public");
    setPassword("");
    setTeamId(null);
    setDestinationSlug("new");
    setDestinationTouched(false);
    setBusy(false);
    setFailures(null);

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
  }, [open, design?.designName, design?.boards, scope]);

  // A publish that something is waiting on (a cloud comment needs its board to
  // have a link) hands back the moment the run lands, rather than when the
  // user gets around to closing the result — the waiting work shouldn't sit
  // behind a dialog it has no more questions for.
  useEffect(() => {
    if (run.state === "done") settlePublish(true);
  }, [run.state, settlePublish]);

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
  const recommendedSlug = matchingSlots[0]?.slug ?? "new";

  useEffect(() => {
    if (!destinationTouched) setDestinationSlug(recommendedSlug);
  }, [destinationTouched, recommendedSlug]);

  useEffect(() => {
    if (destinationSlug !== "new" && !matchingSlots.some((slot) => slot.slug === destinationSlug)) {
      setDestinationTouched(false);
      setDestinationSlug(recommendedSlug);
    }
  }, [destinationSlug, matchingSlots, recommendedSlug]);

  // Derived rather than reset: a board-menu "Private" on a free plan, or a
  // plan read that lands after the form opened, must not send what the plan
  // can't honor — and must not wipe the rest of the form either.
  const effectiveVisibility = protectedShares ? visibility : "public";
  const effectivePassword = protectedShares ? password : "";
  const scopeMode = scope ? (protectedShares ? scope.mode : "public") : null;

  const buildRequest = (): PublishRequest => {
    const destination: PublishRequest["destination"] = selectedSlot
      ? {
          mode: "update",
          slug: selectedSlot.slug,
          expectedVersionId: selectedSlot.latestVersionId,
        }
      : { mode: "new" };
    return {
      boardIds,
      ...(title.trim() ? { title: title.trim() } : {}),
      visibility: effectiveVisibility,
      ...(effectivePassword.length >= 3 ? { password: effectivePassword } : {}),
      ...(teamId ? { teamId } : {}),
      destination,
    };
  };

  const start = async () => {
    setBusy(true);
    // The publish renders a placeholder where a component threw rather than
    // failing, so ask before that lands on a link someone else opens. Checking
    // here rather than in the daemon is what lets the answer still be "no":
    // the run goes asynchronous the moment it starts. A pre-flight that itself
    // fails is not a reason to block the publish.
    const found = await preflightBoards(boardIds).catch(() => []);
    if (found.length > 0) {
      setBusy(false);
      setFailures(found);
      return;
    }
    await startRun(buildRequest());
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
  const passwordMissing = scopeMode === "password" && password.length < 3;

  const signInAgain = (opts: { expired: boolean }) => {
    setOpen(false);
    openSignIn({ action: "publish these boards", ...(opts.expired ? { expired: true } : {}) });
  };

  return (
    <>
      <RenderFailureDialog
        failures={failures}
        verb="Publish"
        onCancel={() => setFailures(null)}
        onConfirm={() => {
          setFailures(null);
          void startRun(buildRequest());
        }}
      />
      <Dialog open={open} onOpenChange={(next) => !next && setOpen(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Publish to velloo-cloud</DialogTitle>
            <DialogDescription>
              {scope
                ? `Sharing “${scope.name}” ${scopeMode === "private" ? "privately" : scopeMode === "password" ? "with password protection" : "publicly"}.`
                : "Share a rendered, commentable copy of these boards by link."}
            </DialogDescription>
          </DialogHeader>

          {unavailable ? (
            <p className="py-4 text-sm text-muted-foreground">
              This canvas isn't running through the velloo CLI, so it has no account to publish
              with.
            </p>
          ) : signedOut ? (
            <div className="flex flex-col gap-3 py-2">
              <p className="text-sm text-muted-foreground">
                {expired
                  ? "Your velloo-cloud session has ended. Sign in again to publish these boards."
                  : "Publishing needs a velloo-cloud account."}
              </p>
              <Button onClick={() => signInAgain({ expired })} className="self-start">
                {expired ? "Sign in again…" : "Sign in…"}
              </Button>
            </div>
          ) : run.state === "running" ? (
            <PublishRunning run={run} />
          ) : run.state === "done" ? (
            <PublishDone run={run} upgradeUrl={upgradeUrl} />
          ) : run.state === "error" ? (
            <PublishFailed
              run={run}
              upgradeUrl={upgradeUrl}
              onSeePublished={() => {
                setOpen(false);
                openPublishedBoards(true);
              }}
              onSignIn={() => signInAgain({ expired: run.signInRequired === "expired" })}
            />
          ) : (
            <PublishForm
              title={title}
              onTitleChange={setTitle}
              boards={boards}
              boardIds={boardIds}
              onToggleBoard={(id, on) =>
                setBoardIds((ids) =>
                  on ? [...new Set([...ids, id])] : ids.filter((x) => x !== id),
                )
              }
              destinationSlug={destinationSlug}
              onDestinationChange={(slug) => {
                setDestinationTouched(true);
                setDestinationSlug(slug);
              }}
              matchingSlots={matchingSlots}
              selectedSlot={selectedSlot}
              destinationError={targets?.destinationError}
              protectedShares={protectedShares}
              visibility={effectiveVisibility}
              onVisibilityChange={setVisibility}
              passwordRequired={scopeMode === "password"}
              password={effectivePassword}
              onPasswordChange={setPassword}
              upgradeUrl={upgradeUrl}
              teams={targets?.teams ?? []}
              teamId={teamId}
              onTeamChange={setTeamId}
            />
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
    </>
  );
}
