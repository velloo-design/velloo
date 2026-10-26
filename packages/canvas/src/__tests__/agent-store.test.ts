import { describe, expect, test } from "bun:test";
import type { AgentEvent, AgentSessionSummary } from "@velloo/protocol/agent";
import { slashEntries, slashQuery } from "../components/Agent/controls.tsx";
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

  test("a live session keeps its newest turns and counts the rest", () => {
    const events: AgentEvent[] = Array.from({ length: 205 }, (_, i) => ({
      event: "turn" as const,
      sessionId: "s",
      turn: { id: `t${i}`, status: "completed" as const, startedAt: "2026-01-01" },
    }));
    const t = run(events).agentTranscripts.s;
    expect(t?.turns).toHaveLength(200);
    expect(t?.turns[0]?.id).toBe("t5");
    expect(t?.turnsDropped).toBe(5);
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

  test("a session's controls arrive whole and leave with its process", () => {
    const controls = { commands: [{ name: "review" }], models: [], mcp: { actions: [] } };
    const live = run([{ event: "controls", sessionId: "s", controls }]);
    expect(live.agentTranscripts.s?.controls).toEqual(controls);
    const gone = run([{ event: "controls", sessionId: "s", controls: null }], live);
    expect(gone.agentTranscripts.s).not.toHaveProperty("controls");
  });

  test("context cards are the same card when they name the same thing", () => {
    const a = { kind: "node" as const, ref: { screenId: "home", path: "0.1" }, label: "Button" };
    expect(contextKey(a)).toBe(contextKey({ ...a, label: "Renamed" }));
    expect(contextKey(a)).not.toBe(contextKey({ ...a, ref: { screenId: "home", path: "0.2" } }));
  });
});

describe("the slash menu's contents", () => {
  const controls = {
    commands: [
      { name: "review", description: "Review" },
      { name: "model", description: "The agent's own" },
      { name: "preview-mode" },
    ],
    models: [{ id: "a", label: "A" }],
    model: "a",
    mcp: { actions: [] },
  };

  test("only a slash and one word is a command being typed", () => {
    expect(slashQuery("/")).toBe("");
    expect(slashQuery("/Rev")).toBe("rev");
    expect(slashQuery("/review now")).toBeNull();
    expect(slashQuery("say /review")).toBeNull();
  });

  test("Velloo's /model and /mcp lead and win a name clash; starts-with before contains", () => {
    expect(slashEntries(controls, "").map((e) => e.name)).toEqual([
      "model",
      "mcp",
      "review",
      "preview-mode",
    ]);
    expect(slashEntries(controls, "", "A")[0]).toMatchObject({
      velloo: "model",
      description: "Switch the model (now A)",
    });
    expect(slashEntries(controls, "rev").map((e) => e.name)).toEqual(["review", "preview-mode"]);
    expect(slashEntries(controls, "zzz")).toEqual([]);
  });

  test("a session that can't switch models or list servers offers neither", () => {
    expect(
      slashEntries({ commands: [{ name: "init" }], models: [] }, "").map((e) => e.name),
    ).toEqual(["init"]);
    expect(slashEntries(undefined, "")).toEqual([]);
  });
});
