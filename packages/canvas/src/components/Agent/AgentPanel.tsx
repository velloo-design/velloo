import type { AgentContextCard, AgentSessionSummary } from "@velloo/protocol/agent";
import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { boardCards, cardStaleness, selectionCard, viewCard } from "../../agent-context.ts";
import { arrivalTitle, handArrivalsToAgent } from "../../comment-arrivals.ts";
import { useCanvas } from "../../store.ts";
import { pushToast } from "../../toast.ts";
import { Loading } from "../Loading.tsx";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert.tsx";
import { Button } from "../ui/button.tsx";
import { ArrivalNotice } from "./arrival-notice.tsx";
import { AgentComposer } from "./composer.tsx";
import { McpPanel, ModelPanel, type VellooCommand } from "./controls.tsx";
import {
  ApprovalCard,
  type CanvasTarget,
  type SentCommentState,
  TurnView,
  targetOfCard,
} from "./conversation.tsx";
import { AgentStart, isLive, SessionHeader } from "./session.tsx";

/** Within this many pixels of the bottom, new output keeps the transcript scrolled to it. */
const STICK_PX = 48;

/** What a screen reader hears when a session changes state — the transcript itself streams too fast to read aloud. */
function announcement(session: AgentSessionSummary, label: string): string {
  switch (session.state) {
    case "running":
      return `${label} is working.`;
    case "awaiting-approval":
      return `${label} is waiting for your approval.`;
    case "idle":
      return `${label} is ready.`;
    case "failed":
      return `${label} stopped unexpectedly.`;
    case "exited":
      return `${label} stopped.`;
    default:
      return "";
  }
}

/**
 * The Agent tab: the person's own CLI agent beside the design. Wires the
 * store to the presentational pieces in this folder, which know nothing of
 * where a session runs.
 */
export function AgentPanel() {
  const providers = useCanvas((s) => s.agentProviders);
  const sessions = useCanvas((s) => s.agentSessions);
  const activeId = useCanvas((s) => s.agentActiveSessionId);
  const transcripts = useCanvas((s) => s.agentTranscripts);
  const draft = useCanvas((s) => s.agentDraft);
  const mismatch = useCanvas((s) => s.agentProtocolMismatch);
  const commentThreads = useCanvas((s) => s.agentCommentThreads);
  const boards = useCanvas((s) => s.boards);
  const screens = useCanvas((s) => s.screens);
  const currentBoardId = useCanvas((s) => s.currentBoardId);
  const selection = useCanvas((s) => s.selection);
  const notes = useCanvas((s) => s.notes);
  const arrivals = useCanvas((s) => s.commentArrivals);
  const actions = useCanvas.getState;
  const [starting, setStarting] = useState<string | null>(null);
  /** The Velloo panel `/model` or `/mcp` opened over the prompt box. */
  const [control, setControl] = useState<VellooCommand | null>(null);
  const loadMcp = useCallback(() => useCanvas.getState().loadAgentMcpServers(), []);

  useEffect(() => {
    if (useCanvas.getState().agentProviders === null) void useCanvas.getState().loadAgent();
  }, []);

  const session = sessions.find((s) => s.id === activeId);
  const transcript = activeId ? transcripts[activeId] : undefined;
  const provider = providers?.find((p) => p.id === session?.provider);
  const label = provider?.label ?? session?.provider ?? "Agent";
  const controls = transcript?.controls;

  // A panel belongs to the session it was opened in.
  // biome-ignore lint/correctness/useExhaustiveDependencies: closing on a switch is the point.
  useEffect(() => setControl(null), [activeId]);

  // Comment cards — drafted or sent — say whether their thread is still open.
  const commentIds = useMemo(() => {
    const cards = [
      ...draft.context,
      ...(transcript?.turns.flatMap((t) =>
        t.items.flatMap((i) => (i.kind === "user" ? (i.context ?? []) : [])),
      ) ?? []),
    ];
    return [...new Set(cards.filter((c) => c.kind === "comment").map((c) => c.ref.threadId ?? ""))]
      .filter(Boolean)
      .sort()
      .join(",");
  }, [draft.context, transcript?.turns]);
  useEffect(() => {
    if (commentIds) void useCanvas.getState().refreshAgentCommentThreads(commentIds.split(","));
  }, [commentIds]);

  const where = useMemo(
    () => ({
      board: currentBoardId ? boards[currentBoardId] : undefined,
      screens,
      selection,
      notes,
    }),
    [boards, screens, selection, currentBoardId, notes],
  );
  const selected = useMemo(() => selectionCard(where), [where]);
  const attachable = useMemo(() => boardCards(where), [where]);

  const view = useMemo(() => viewCard(where), [where]);

  const staleness = useCallback(
    (card: AgentContextCard) => cardStaleness(card, { boards, screens, threads: commentThreads }),
    [boards, screens, commentThreads],
  );

  const cwd = session?.environment?.cwd;
  const callbacks = useMemo(
    () => ({
      cwd,
      onReveal: (target: CanvasTarget) => {
        const s = useCanvas.getState();
        if (target.screenId) {
          void s.locateNode(target.screenId, target.path ?? "", {
            preserveTab: true,
            ...(target.frameId ? { frameId: target.frameId } : {}),
            ...(target.boardId ? { hostBoards: [target.boardId] } : {}),
          });
        } else if (target.boardId) void s.selectBoard(target.boardId);
      },
      onResolveComment: async (threadId: string) => {
        await useCanvas.getState().setCommentResolved(threadId, true);
        await useCanvas.getState().refreshAgentCommentThreads([threadId]);
      },
      commentState: (threadId: string): SentCommentState | undefined => {
        if (!(threadId in commentThreads)) return undefined;
        const thread = commentThreads[threadId];
        return !thread ? "gone" : thread.status === "resolved" ? "resolved" : "open";
      },
    }),
    [commentThreads, cwd],
  );

  // Follow new output while the reader is at the bottom; leave them be when
  // they've scrolled up to read something.
  const scroller = useRef<HTMLDivElement>(null);
  const stuck = useRef(true);
  const shownSession = useRef(activeId);
  // Every render, not on chosen deps: streamed text grows the transcript
  // without changing any one value worth listing.
  useEffect(() => {
    const el = scroller.current;
    if (shownSession.current !== activeId) {
      shownSession.current = activeId;
      stuck.current = true;
    }
    if (el && stuck.current) el.scrollTop = el.scrollHeight;
  });

  const notices =
    arrivals.length > 0 ? (
      <section
        className="flex flex-col gap-2 border-b border-border px-3 py-2"
        aria-label="New comments"
      >
        {arrivals.map((arrival) => (
          <ArrivalNotice
            key={arrival.boardId}
            title={arrivalTitle(arrival)}
            onAdd={() => void handArrivalsToAgent([arrival])}
            onDismiss={() => void actions().acknowledgeCommentArrivals(arrival.messageIds)}
          />
        ))}
      </section>
    ) : null;

  if (mismatch) {
    return (
      <div className="p-3">
        <Alert>
          <AlertTitle className="text-xs">Velloo was updated</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-1.5 text-[11px]">
            <span>Reload the canvas to keep following the agent.</span>
            <Button variant="outline" size="xs" onClick={() => window.location.reload()}>
              <RefreshCw size={12} aria-hidden />
              Reload
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (providers === null) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loading size={20} label="Looking for agents…" className="flex-col" />
      </div>
    );
  }

  if (!session) {
    const waiting = draft.context.length;
    return (
      <>
        {notices}
        {waiting > 0 ? (
          <p className="border-b border-border px-3 py-2 text-[11px] text-muted-foreground">
            {waiting} {waiting === 1 ? "card is" : "cards are"} waiting in the composer — start a
            session to send {waiting === 1 ? "it" : "them"}.
          </p>
        ) : null}
        <AgentStart
          providers={providers}
          // A session that never got going (not signed in, say) isn't "used".
          preferred={sessions.find((s) => s.state !== "failed")?.provider}
          recent={sessions}
          starting={starting}
          onStart={async (id) => {
            setStarting(id);
            await actions().startAgentSession(id);
            setStarting(null);
          }}
          onCheckAgain={() => void actions().refreshAgentProviders()}
          onOpen={(id) => void actions().selectAgentSession(id)}
          onReopen={(id) => void actions().reopenAgentSession(id)}
        />
      </>
    );
  }

  const live = isLive(session);
  const running = session.state === "running" || session.state === "awaiting-approval";
  const followUp = provider?.capabilities.followUp ?? "none";
  const runningTurn = running
    ? transcript?.turns.findLast((t) => t.status === "running")
    : undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-agent-panel>
      <SessionHeader
        session={session}
        sessions={sessions}
        provider={provider}
        runningSince={runningTurn?.startedAt}
        onSwitch={(id) => void actions().selectAgentSession(id)}
        onNew={() => void actions().selectAgentSession(null)}
        onBack={() => void actions().selectAgentSession(null)}
        onNewWithAgent={() => void actions().startAgentSession(session.provider)}
        onRename={(title) => void actions().renameAgentSession(session.id, title)}
        onCopyResume={() => {
          const command = session.terminalCommand?.join(" ") ?? "";
          const cwd = session.environment?.cwd;
          const line = cwd ? `cd ${JSON.stringify(cwd)} && ${command}` : command;
          void navigator.clipboard?.writeText(line).then(
            () =>
              pushToast({
                kind: "success",
                message: "Copied — paste it in a terminal to continue there.",
              }),
            () => pushToast({ kind: "error", message: "Couldn't copy the command." }),
          );
        }}
        onStop={() => void actions().stopAgentSession(session.id)}
        onReopen={() => void actions().reopenAgentSession(session.id)}
        onDelete={() => void actions().removeAgentSession(session.id)}
      />
      {notices}
      <p className="sr-only" aria-live="polite">
        {announcement(session, label)}
      </p>
      <div
        ref={scroller}
        className="scroll-stable min-h-0 flex-1 overflow-y-auto"
        onScroll={(e) => {
          const el = e.currentTarget;
          stuck.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_PX;
        }}
      >
        <div
          className="flex flex-col gap-4 px-3 py-4"
          role="log"
          aria-live="off"
          aria-label={`Conversation with ${label}`}
        >
          {transcript && transcript.turnsDropped > 0 ? (
            <p className="text-center text-[11px] text-muted-foreground">
              {transcript.turnsDropped} earlier {transcript.turnsDropped === 1 ? "turn" : "turns"}{" "}
              not shown
            </p>
          ) : null}
          {transcript?.turns.length ? (
            transcript.turns.map((turn) => (
              <TurnView
                key={turn.id}
                turn={turn}
                provider={session.provider}
                providerLabel={label}
                waiting={turn.status === "running" && (transcript.approvals.length ?? 0) > 0}
                callbacks={callbacks}
              />
            ))
          ) : live ? (
            <p className="text-xs text-muted-foreground">
              {session.state === "starting"
                ? `Starting ${label}…`
                : `Ask ${label} to change the design, or attach something from the canvas below.`}
            </p>
          ) : null}
        </div>
      </div>
      {transcript?.approvals.length ? (
        <section className="flex flex-col gap-2 px-3 pb-3" aria-label="Waiting for your approval">
          {transcript.approvals.map((request) => (
            <ApprovalCard
              key={request.id}
              request={request}
              providerLabel={label}
              onAnswer={(decision) => void actions().answerAgentApproval(request.id, decision)}
            />
          ))}
        </section>
      ) : null}
      {live && control === "model" && controls?.models.length ? (
        <div className="px-3 pt-2">
          <ModelPanel
            controls={controls}
            providerLabel={label}
            onPick={(model) => actions().setAgentModel(model)}
            onClose={() => setControl(null)}
          />
        </div>
      ) : null}
      {live && control === "mcp" && controls?.mcp ? (
        <div className="px-3 pt-2">
          <McpPanel
            providerLabel={label}
            actions={controls.mcp.actions}
            load={loadMcp}
            act={(server, action) => actions().agentMcpAction(server, action)}
            onClose={() => setControl(null)}
          />
        </div>
      ) : null}
      {live ? (
        <AgentComposer
          controls={controls}
          modeFallback={session.environment?.sandbox}
          onMode={(mode) => void actions().setAgentMode(mode)}
          modelLabel={
            controls?.models.find((m) => m.id === controls.model)?.label ??
            session.environment?.model
          }
          onModel={(model) => actions().setAgentModel(model)}
          onControl={setControl}
          text={draft.text}
          cards={draft.context}
          selection={selected}
          attachable={attachable}
          staleness={staleness}
          providerLabel={label}
          running={running}
          followUp={followUp}
          queued={transcript?.queued ?? []}
          disabled={session.state === "starting"}
          onText={(text) => actions().setAgentDraftText(text)}
          onSend={() => {
            stuck.current = true;
            void actions().sendAgentPrompt(view);
          }}
          onStop={() => void actions().interruptAgent()}
          onAttach={(card) => actions().addAgentContext([card])}
          onRemove={(card) => actions().removeAgentContext(card)}
          onClearComments={() => actions().clearAgentComments()}
          onDequeue={(id) => void actions().dequeueAgentPrompt(id)}
          onReveal={(card) => callbacks.onReveal(targetOfCard(card))}
          view={view}
        />
      ) : (
        <div className="flex flex-col gap-2 border-t border-border p-3 text-xs text-muted-foreground">
          <span>
            {session.resumable
              ? `${label} isn't running. Reopen the session to continue it, or start a new one.`
              : "This session has ended. Start a new one to keep going."}
          </span>
          <div className="flex gap-1.5">
            {session.resumable ? (
              <Button size="xs" onClick={() => void actions().reopenAgentSession(session.id)}>
                Reopen
              </Button>
            ) : null}
            <Button
              size="xs"
              variant="outline"
              onClick={() => void actions().selectAgentSession(null)}
            >
              New session
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
