import {
  AGENT_PROTOCOL_VERSION,
  type AgentAnswers,
  type AgentApprovalDecision,
  type AgentApprovalRequest,
  type AgentContextCard,
  type AgentEvent,
  type AgentFrame,
  type AgentItem,
  type AgentMcpAction,
  type AgentMcpServer,
  type AgentProviderInfo,
  type AgentSessionControls,
  type AgentSessionSnapshot,
  type AgentSessionSummary,
  type AgentTurn,
} from "@velloo/protocol/agent";
import type { CommentThread } from "@velloo/schema";
import type { StateCreator } from "zustand";
import { commentCard } from "../agent-context.ts";
import { agent } from "../api/agent.ts";
import { comments } from "../api/comments.ts";
import { toastError } from "../toast.ts";
import type { CanvasState } from "./index.ts";
import { revealPane } from "./modes.ts";

/** One session's conversation as the canvas holds it: a snapshot patched by frames. */
interface AgentTranscript {
  turns: AgentTurn[];
  turnsDropped: number;
  approvals: AgentApprovalRequest[];
  queued: { id: string; text: string }[];
  /** What the live process offers besides prompts — the slash menu. */
  controls?: AgentSessionControls;
}

/** What the composer holds before it is sent. */
interface AgentDraft {
  text: string;
  context: AgentContextCard[];
}

export interface AgentSlice {
  /** Null until the tab first asks; the daemon may have none to offer. */
  agentProviders: AgentProviderInfo[] | null;
  agentSessions: AgentSessionSummary[];
  agentTranscripts: Record<string, AgentTranscript>;
  agentActiveSessionId: string | null;
  agentDraft: AgentDraft;
  /** The daemon speaks a newer agent protocol than this canvas: reload to read it. */
  agentProtocolMismatch: boolean;
  agentLoading: boolean;
  /**
   * The comment threads the composer's and the transcript's cards refer to,
   * fetched by id: the comments panel holds one board's threads under its own
   * filter, so it can't say whether a card's comment was resolved or deleted.
   * `null` means the thread is gone.
   */
  agentCommentThreads: Record<string, CommentThread | null>;
  /** Send where the person is with the next message. Removed for one message at a time. */

  loadAgent(): Promise<void>;
  refreshAgentProviders(): Promise<void>;
  selectAgentSession(id: string | null): Promise<void>;
  startAgentSession(provider: string, resume?: string): Promise<void>;
  reopenAgentSession(id: string): Promise<void>;
  /** Send the draft, with `view` — where the person is — unless they removed it. */
  sendAgentPrompt(view?: AgentContextCard | null): Promise<boolean>;
  interruptAgent(): Promise<void>;
  answerAgentApproval(
    approvalId: string,
    decision: AgentApprovalDecision,
    answers?: AgentAnswers,
  ): Promise<void>;
  dequeueAgentPrompt(queuedId: string): Promise<void>;
  renameAgentSession(id: string, title: string): Promise<void>;
  stopAgentSession(id: string): Promise<void>;
  removeAgentSession(id: string): Promise<void>;
  /** `/model` on the active session. */
  setAgentModel(model: string): Promise<boolean>;
  /** Switch the active session's permission mode. */
  setAgentMode(mode: string): Promise<boolean>;
  /** `/mcp`: the active session's MCP servers, or null when they couldn't be read. */
  loadAgentMcpServers(): Promise<AgentMcpServer[] | null>;
  agentMcpAction(server: string, action: AgentMcpAction): Promise<boolean>;
  applyAgentFrame(frame: AgentFrame): void;
  setAgentDraftText(text: string): void;
  addAgentContext(cards: AgentContextCard[], opts?: { reveal?: boolean }): void;
  removeAgentContext(card: AgentContextCard): void;
  clearAgentComments(): void;
  /** Put comments in the composer as cards and open the Agent tab. Nothing is sent. */
  addCommentsToAgent(threads: { threadId: string; messageIds?: string[] }[]): Promise<void>;
  refreshAgentCommentThreads(threadIds?: string[]): Promise<void>;
}

/** Matches the daemon's own bound, so a long-running command can't grow the DOM without limit. */
const OUTPUT_TAIL = 32_000;
const TURNS_KEPT = 200;

/** Two cards name the same thing when their kind and canvas address match. */
export function contextKey(card: AgentContextCard): string {
  const { ref } = card;
  return [
    card.kind,
    ref.boardId,
    ref.screenId,
    ref.frameId,
    ref.path,
    ref.noteId,
    ref.threadId,
    ref.messageId,
  ].join("|");
}

const emptyTranscript = (): AgentTranscript => ({
  turns: [],
  turnsDropped: 0,
  approvals: [],
  queued: [],
});

function upsertSession(
  list: AgentSessionSummary[],
  session: AgentSessionSummary,
): AgentSessionSummary[] {
  const rest = list.filter((s) => s.id !== session.id);
  return [session, ...rest].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function patchItem(item: AgentItem, field: "text" | "output", delta: string): AgentItem {
  if (field === "text" && item.kind !== "command" && "text" in item) {
    return { ...item, text: item.text + delta } as AgentItem;
  }
  if (field === "output" && item.kind === "command") {
    const output = item.output + delta;
    if (output.length <= OUTPUT_TAIL) return { ...item, output };
    const dropped = output.length - OUTPUT_TAIL;
    return {
      ...item,
      output: output.slice(dropped),
      outputDropped: (item.outputDropped ?? 0) + dropped,
    };
  }
  return item;
}

function withTurn(
  t: AgentTranscript,
  turnId: string,
  change: (turn: AgentTurn) => AgentTurn,
): AgentTranscript {
  const index = t.turns.findIndex((turn) => turn.id === turnId);
  const base: AgentTurn =
    index >= 0
      ? (t.turns[index] as AgentTurn)
      : { id: turnId, status: "running", items: [], startedAt: new Date().toISOString() };
  const next = change(base);
  const turns =
    index >= 0 ? t.turns.map((turn, i) => (i === index ? next : turn)) : [...t.turns, next];
  // The daemon's own bound: a session left running for days doesn't grow the page.
  const drop = Math.max(0, turns.length - TURNS_KEPT);
  return { ...t, turns: drop ? turns.slice(drop) : turns, turnsDropped: t.turnsDropped + drop };
}

/**
 * Apply one live event to the transcripts and session list. Pure, so the
 * ordering cases a provider produces (an item before its turn, a delta for an
 * item another frame replaced) are testable without a socket.
 */
export function applyAgentEvent(
  state: Pick<AgentSlice, "agentSessions" | "agentTranscripts" | "agentProviders">,
  event: AgentEvent,
): Pick<AgentSlice, "agentSessions" | "agentTranscripts" | "agentProviders"> {
  const { agentSessions, agentTranscripts } = state;
  const transcript = (id: string) => agentTranscripts[id] ?? emptyTranscript();
  const put = (id: string, t: AgentTranscript) => ({
    ...state,
    agentTranscripts: { ...agentTranscripts, [id]: t },
  });
  switch (event.event) {
    case "providers":
      return { ...state, agentProviders: event.providers };
    case "session":
      return { ...state, agentSessions: upsertSession(agentSessions, event.session) };
    case "session-removed": {
      const { [event.sessionId]: _gone, ...rest } = agentTranscripts;
      return {
        ...state,
        agentSessions: agentSessions.filter((s) => s.id !== event.sessionId),
        agentTranscripts: rest,
      };
    }
    case "turn":
      return put(
        event.sessionId,
        withTurn(transcript(event.sessionId), event.turn.id, (turn) => ({
          ...turn,
          ...event.turn,
        })),
      );
    case "item":
      return put(
        event.sessionId,
        withTurn(transcript(event.sessionId), event.turnId, (turn) => {
          const index = turn.items.findIndex((i) => i.id === event.item.id);
          const items =
            index >= 0
              ? turn.items.map((i, n) => (n === index ? event.item : i))
              : event.item.kind === "user"
                ? // The prompt leads its turn even when the provider's first item beat it here.
                  [event.item, ...turn.items]
                : [...turn.items, event.item];
          return { ...turn, items };
        }),
      );
    case "delta":
      return put(
        event.sessionId,
        withTurn(transcript(event.sessionId), event.turnId, (turn) => ({
          ...turn,
          items: turn.items.map((i) =>
            i.id === event.itemId ? patchItem(i, event.field, event.delta) : i,
          ),
        })),
      );
    case "approval": {
      const t = transcript(event.sessionId);
      return put(event.sessionId, {
        ...t,
        approvals: [...t.approvals.filter((a) => a.id !== event.request.id), event.request],
      });
    }
    case "approval-resolved": {
      const t = transcript(event.sessionId);
      return put(event.sessionId, {
        ...t,
        approvals: t.approvals.filter((a) => a.id !== event.approvalId),
      });
    }
    case "queue":
      return put(event.sessionId, { ...transcript(event.sessionId), queued: event.queued });
    case "controls": {
      const { controls: _old, ...t } = transcript(event.sessionId);
      return put(event.sessionId, event.controls ? { ...t, controls: event.controls } : t);
    }
  }
}

function fromSnapshot(snapshot: AgentSessionSnapshot): AgentTranscript {
  return {
    turns: snapshot.turns,
    turnsDropped: snapshot.turnsDropped,
    approvals: snapshot.approvals,
    queued: snapshot.queued,
    ...(snapshot.controls ? { controls: snapshot.controls } : {}),
  };
}

const LIVE = new Set(["starting", "idle", "running", "awaiting-approval"]);

export const createAgentSlice: StateCreator<CanvasState, [], [], AgentSlice> = (set, get) => {
  async function loadSnapshot(id: string) {
    const snapshot = await agent.snapshot(id);
    set((s) => ({
      agentSessions: upsertSession(s.agentSessions, snapshot.session),
      agentTranscripts: { ...s.agentTranscripts, [id]: fromSnapshot(snapshot) },
    }));
  }

  /** Run a call against the active session, surfacing a failure as a toast. */
  async function onActive(label: string, run: (id: string) => Promise<unknown>) {
    const id = get().agentActiveSessionId;
    if (!id) return;
    try {
      await run(id);
    } catch (error) {
      toastError(error, label);
    }
  }

  return {
    agentProviders: null,
    agentSessions: [],
    agentTranscripts: {},
    agentActiveSessionId: null,
    agentDraft: { text: "", context: [] },
    agentProtocolMismatch: false,
    agentLoading: false,
    agentCommentThreads: {},

    async loadAgent() {
      set({ agentLoading: true });
      try {
        const [{ providers }, { sessions }] = await Promise.all([
          agent.providers(),
          agent.sessions(),
        ]);
        const active = get().agentActiveSessionId;
        const keep = active && sessions.some((s) => s.id === active) ? active : null;
        const next = keep ?? sessions.find((s) => LIVE.has(s.state))?.id ?? null;
        set({ agentProviders: providers, agentSessions: sessions, agentActiveSessionId: next });
        if (next) await loadSnapshot(next);
      } catch (error) {
        // A daemon without agents answers 404; the tab shows the setup state.
        set({ agentProviders: [] });
        if (!(error instanceof Error && /not enabled/i.test(error.message))) {
          toastError(error, "Could not load agent sessions");
        }
      } finally {
        set({ agentLoading: false });
      }
    },

    async refreshAgentProviders() {
      try {
        const { providers } = await agent.providers(true);
        set({ agentProviders: providers });
      } catch (error) {
        toastError(error, "Could not check the agents on this computer");
      }
    },

    async selectAgentSession(id) {
      set({ agentActiveSessionId: id });
      if (!id) return;
      try {
        await loadSnapshot(id);
      } catch (error) {
        toastError(error, "Could not open that session");
      }
    },

    async startAgentSession(provider, resume) {
      try {
        const { session } = await agent.start({ provider, ...(resume ? { resume } : {}) });
        set((s) => ({
          agentSessions: upsertSession(s.agentSessions, session),
          agentActiveSessionId: session.id,
        }));
        await loadSnapshot(session.id);
      } catch (error) {
        toastError(error, "Could not start the agent");
        void get().loadAgent();
      }
    },

    async reopenAgentSession(id) {
      try {
        const { session } = await agent.reopen(id);
        set((s) => ({
          agentSessions: upsertSession(s.agentSessions, session),
          agentActiveSessionId: id,
        }));
        await loadSnapshot(id);
      } catch (error) {
        toastError(error, "Could not reopen the session");
      }
    },

    async sendAgentPrompt(view) {
      const id = get().agentActiveSessionId;
      const draft = get().agentDraft;
      if (!id || (!draft.text.trim() && draft.context.length === 0)) return false;
      // A slash command is for the agent, not about the design: it goes
      // alone, and the cards wait for the next message.
      const command = draft.text.trimStart().startsWith("/");
      const context = command ? [] : [...(view ? [view] : []), ...draft.context];
      // Cleared at once, so the box is ready for the next thought; a failed
      // send puts the draft back unless something new was typed meanwhile.
      set(
        command
          ? { agentDraft: { text: "", context: draft.context } }
          : { agentDraft: { text: "", context: [] } },
      );
      try {
        await agent.prompt(id, {
          text: draft.text,
          ...(context.length ? { context } : {}),
        });
        return true;
      } catch (error) {
        set((s) =>
          s.agentDraft.text ||
          (command ? s.agentDraft.context !== draft.context : s.agentDraft.context.length > 0)
            ? {}
            : { agentDraft: draft },
        );
        toastError(error, "Could not send to the agent");
        return false;
      }
    },

    interruptAgent: () => onActive("Could not stop the turn", (id) => agent.interrupt(id)),

    answerAgentApproval: (approvalId, decision, answers) =>
      onActive("Could not answer the agent", (id) =>
        agent.answer(id, approvalId, decision, answers),
      ),

    dequeueAgentPrompt: (queuedId) =>
      onActive("Could not remove the queued message", (id) => agent.dequeue(id, queuedId)),

    async renameAgentSession(id, title) {
      try {
        const { session } = await agent.rename(id, title);
        set((s) => ({ agentSessions: upsertSession(s.agentSessions, session) }));
      } catch (error) {
        toastError(error, "Could not rename the session");
      }
    },

    async stopAgentSession(id) {
      try {
        await agent.stop(id);
      } catch (error) {
        toastError(error, "Could not stop the agent");
      }
    },

    async setAgentModel(model) {
      const id = get().agentActiveSessionId;
      if (!id) return false;
      try {
        const { session } = await agent.setModel(id, model);
        set((s) => ({ agentSessions: upsertSession(s.agentSessions, session) }));
        return true;
      } catch (error) {
        toastError(error, "Could not switch the model");
        return false;
      }
    },

    async setAgentMode(mode) {
      const id = get().agentActiveSessionId;
      if (!id) return false;
      try {
        const { session } = await agent.setMode(id, mode);
        set((s) => ({ agentSessions: upsertSession(s.agentSessions, session) }));
        return true;
      } catch (error) {
        toastError(error, "Could not switch the permission mode");
        return false;
      }
    },

    async loadAgentMcpServers() {
      const id = get().agentActiveSessionId;
      if (!id) return null;
      try {
        return (await agent.mcpServers(id)).servers;
      } catch (error) {
        toastError(error, "Could not read the agent's MCP servers");
        return null;
      }
    },

    async agentMcpAction(server, action) {
      const id = get().agentActiveSessionId;
      if (!id) return false;
      try {
        await agent.mcpAction(id, server, action);
        return true;
      } catch (error) {
        toastError(error, `Could not ${action} ${server}`);
        return false;
      }
    },

    async removeAgentSession(id) {
      try {
        await agent.remove(id);
        if (get().agentActiveSessionId === id) set({ agentActiveSessionId: null });
      } catch (error) {
        toastError(error, "Could not delete the session");
      }
    },

    applyAgentFrame(frame) {
      if (frame.v !== AGENT_PROTOCOL_VERSION) {
        set({ agentProtocolMismatch: true });
        return;
      }
      set((s) => applyAgentEvent(s, frame));
    },

    setAgentDraftText(text) {
      set((s) => ({ agentDraft: { ...s.agentDraft, text } }));
    },

    addAgentContext(cards, opts) {
      set((s) => {
        const have = new Set(s.agentDraft.context.map(contextKey));
        const fresh = cards.filter((card) => !have.has(contextKey(card)));
        return {
          agentDraft: { ...s.agentDraft, context: [...s.agentDraft.context, ...fresh] },
          ...(opts?.reveal ? { rightTab: "agent" as const, ...revealPane(s, "right") } : {}),
        };
      });
    },

    clearAgentComments() {
      set((s) => ({
        agentDraft: {
          ...s.agentDraft,
          context: s.agentDraft.context.filter((c) => c.kind !== "comment"),
        },
      }));
    },

    async addCommentsToAgent(requests) {
      const found = await Promise.all(
        requests.map(async (r) => ({
          ...r,
          thread: await comments.get(r.threadId).catch(() => null),
        })),
      );
      const { boards, screens } = get();
      const cards = found.flatMap(({ thread, messageIds }) => {
        if (!thread) return [];
        const board = boards[thread.boardId];
        const mine = messageIds?.filter((id) =>
          thread.messages.some((m) => m.id === id && !m.deletedAt),
        );
        return mine?.length
          ? mine.map((id) => commentCard(thread, board, screens, id))
          : [commentCard(thread, board, screens)];
      });
      set((s) => ({
        agentCommentThreads: {
          ...s.agentCommentThreads,
          ...Object.fromEntries(found.map((f) => [f.threadId, f.thread])),
        },
      }));
      if (cards.length) get().addAgentContext(cards, { reveal: true });
    },

    async refreshAgentCommentThreads(threadIds) {
      const ids =
        threadIds ??
        [
          ...new Set(
            [
              ...get().agentDraft.context,
              ...Object.values(get().agentTranscripts).flatMap((t) =>
                t.turns.flatMap((turn) =>
                  turn.items.flatMap((i) => (i.kind === "user" ? (i.context ?? []) : [])),
                ),
              ),
            ]
              .filter((c) => c.kind === "comment" && c.ref.threadId)
              .map((c) => c.ref.threadId as string),
          ),
        ].slice(-50);
      if (ids.length === 0) return;
      const found = await Promise.all(
        ids.map(async (id) => [id, await comments.get(id).catch(() => null)] as const),
      );
      set((s) => ({
        agentCommentThreads: { ...s.agentCommentThreads, ...Object.fromEntries(found) },
      }));
    },

    removeAgentContext(card) {
      const key = contextKey(card);
      set((s) => ({
        agentDraft: {
          ...s.agentDraft,
          context: s.agentDraft.context.filter((c) => contextKey(c) !== key),
        },
      }));
    },
  };
};
