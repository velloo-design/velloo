import { describe, expect, test } from "bun:test";
import type { AgentEvent, AgentSessionSummary } from "@velloo/protocol/agent";
import { type AgentSlice, applyAgentEvent, contextKey } from "../store/agent.ts";

type State = Pick<AgentSlice, "agentSessions" | "agentTranscripts" | "agentProviders">;
const empty: State = { agentSessions: [], agentTranscripts: {}, agentProviders: null };
const run = (events: AgentEvent[], state: State = empty) => events.reduce(applyAgentEvent, state);

const summary = (id: string, updatedAt: string): AgentSessionSummary => ({
  id,
  provider: "codex",
  title: id,
  state: "idle",
  resumable: true,
  createdAt: updatedAt,
  updatedAt,
});

describe("applying agent frames", () => {
  test("sessions upsert and stay newest first", () => {
    const state = run([
      { event: "session", session: summary("a", "2026-01-01") },
      { event: "session", session: summary("b", "2026-01-02") },
      { event: "session", session: { ...summary("a", "2026-01-03"), title: "renamed" } },
    ]);
    expect(state.agentSessions.map((s) => s.id)).toEqual(["a", "b"]);
    expect(state.agentSessions[0]?.title).toBe("renamed");
  });

  test("an item before its turn creates the turn, and deltas extend it", () => {
    const state = run([
      {
        event: "item",
        sessionId: "s",
        turnId: "t",
        item: { kind: "agent-text", id: "x", text: "Hi" },
      },
      { event: "delta", sessionId: "s", turnId: "t", itemId: "x", field: "text", delta: " there" },
      {
        event: "turn",
        sessionId: "s",
        turn: { id: "t", status: "completed", startedAt: "2026-01-01" },
      },
    ]);
    const turn = state.agentTranscripts.s?.turns[0];
    expect(turn?.status).toBe("completed");
    expect(turn?.items).toEqual([{ kind: "agent-text", id: "x", text: "Hi there" }]);
  });

  test("the prompt leads its turn even when it arrives after the agent's first item", () => {
    const state = run([
      {
        event: "item",
        sessionId: "s",
        turnId: "t",
        item: { kind: "agent-text", id: "x", text: "" },
      },
      { event: "item", sessionId: "s", turnId: "t", item: { kind: "user", id: "u", text: "go" } },
    ]);
    expect(state.agentTranscripts.s?.turns[0]?.items.map((i) => i.kind)).toEqual([
      "user",
      "agent-text",
    ]);
  });

  test("command output keeps a bounded tail", () => {
    const state = run([
      {
        event: "item",
        sessionId: "s",
        turnId: "t",
        item: { kind: "command", id: "c", command: "x", status: "running", output: "" },
      },
      {
        event: "delta",
        sessionId: "s",
        turnId: "t",
        itemId: "c",
        field: "output",
        delta: "y".repeat(40_000),
      },
    ]);
    const item = state.agentTranscripts.s?.turns[0]?.items[0];
    expect(item?.kind === "command" && item.output.length).toBe(32_000);
    expect(item?.kind === "command" && item.outputDropped).toBe(8_000);
  });

  test("approvals come and go by id, and removed sessions drop their transcript", () => {
    const request = {
      id: "a1",
      kind: "command" as const,
      title: "Run",
      decisions: ["deny" as const],
      requestedAt: "2026-01-01",
    };
    let state = run([
      { event: "session", session: summary("s", "2026-01-01") },
      { event: "approval", sessionId: "s", request },
      { event: "approval", sessionId: "s", request },
    ]);
    expect(state.agentTranscripts.s?.approvals).toHaveLength(1);
    state = run([{ event: "approval-resolved", sessionId: "s", approvalId: "a1" }], state);
    expect(state.agentTranscripts.s?.approvals).toEqual([]);
    state = run([{ event: "session-removed", sessionId: "s" }], state);
    expect(state.agentSessions).toEqual([]);
    expect(state.agentTranscripts.s).toBeUndefined();
  });

  test("context cards are the same card when they name the same thing", () => {
    const a = { kind: "node" as const, ref: { screenId: "home", path: "0.1" }, label: "Button" };
    expect(contextKey(a)).toBe(contextKey({ ...a, label: "Renamed" }));
    expect(contextKey(a)).not.toBe(contextKey({ ...a, ref: { screenId: "home", path: "0.2" } }));
  });
});
