import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AGENT_PROTOCOL_VERSION,
  type AgentFrame,
  type AgentSessionSummary,
  parseAgentFrame,
} from "@velloo/protocol/agent";
import { parseSocketFrame } from "@velloo/protocol/canvas";
import { AgentError } from "../agent/adapter.ts";
import { LIMITS } from "../agent/bounds.ts";
import { AgentSessionManager } from "../agent/sessions.ts";
import { FakeAgentAdapter } from "../agent/testing.ts";
import { createAgentRouter } from "../routes/agent.ts";

let dir: string;
let frames: AgentFrame[];
let fake: FakeAgentAdapter;

function manager(adapter = fake): AgentSessionManager {
  return new AgentSessionManager({
    adapters: [adapter],
    broadcast: (frame) => frames.push(frame),
    launch: () => ({
      cwd: "/app",
      mcp: { name: "velloo", url: "http://127.0.0.1:1/mcp" },
      instructions: "hi",
    }),
    storeDir: dir,
  });
}

const settle = () => Bun.sleep(450);

function sink() {
  if (!fake.sink) throw new Error("the fake provider hasn't started");
  return fake.sink;
}

async function promptTurn(agents: AgentSessionManager, id: string, body: { text: string }) {
  const { turnId } = await agents.prompt(id, body);
  if (!turnId) throw new Error("no turn started");
  return turnId;
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "velloo-agents-"));
  frames = [];
  fake = new FakeAgentAdapter();
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("the agent session manager", () => {
  test("starts a session with the daemon's launch, not the caller's", async () => {
    const agents = manager();
    const session = await agents.start({ provider: "fake" });
    expect(session.state).toBe("idle");
    expect(session.environment?.cwd).toBe("/app");
    expect(session.resumable).toBe(true);
    expect(fake.launches[0]?.mcp?.url).toBe("http://127.0.0.1:1/mcp");
    expect(agents.liveCount()).toBe(1);
  });

  test("streams a turn: the prompt, deltas, items and completion", async () => {
    const agents = manager();
    const { id } = await agents.start({ provider: "fake" });
    const { mode, turnId = "" } = await agents.prompt(id, { text: "Make the hero taller" });
    expect(mode).toBe("started");
    expect(agents.list()[0]?.title).toBe("Make the hero taller");
    expect(agents.list()[0]?.state).toBe("running");

    const provider = sink();
    provider.item(turnId, { kind: "agent-text", id: "a", text: "" });
    provider.delta(turnId, "a", "text", "On ");
    provider.delta(turnId, "a", "text", "it.");
    provider.item(turnId, {
      kind: "command",
      id: "c",
      command: "ls",
      status: "running",
      output: "",
    });
    provider.delta(turnId, "c", "output", "file\n");
    provider.turnCompleted(turnId, "completed");

    const snap = agents.snapshot(id);
    expect(snap.session.state).toBe("idle");
    const items = snap.turns[0]?.items ?? [];
    expect(items.map((i) => i.kind)).toEqual(["user", "agent-text", "command"]);
    expect(items[1]).toMatchObject({ text: "On it." });
    expect(items[2]).toMatchObject({ output: "file\n" });
    expect(snap.turns[0]?.status).toBe("completed");
    expect(frames.some((f) => f.event === "delta")).toBe(true);
    expect(frames.every((f) => f.type === "agent" && f.v === AGENT_PROTOCOL_VERSION)).toBe(true);
  });

  test("a frame round-trips through the socket parsers", async () => {
    const agents = manager();
    await agents.start({ provider: "fake" });
    const wire = JSON.stringify(frames.at(-1));
    expect(parseSocketFrame(wire)?.type).toBe("agent");
    expect(parseAgentFrame(JSON.parse(wire))?.event).toBe("session");
    expect(
      parseAgentFrame({ type: "agent", v: AGENT_PROTOCOL_VERSION, event: "nonsense" }),
    ).toBeNull();
  });

  test("approvals wait on the person, and only offered decisions are accepted", async () => {
    const agents = manager();
    const { id } = await agents.start({ provider: "fake" });
    const turnId = await promptTurn(agents, id, { text: "rm the cache" });
    sink().approval({
      id: "ap1",
      turnId: turnId,
      kind: "command",
      title: "Run a command",
      command: "rm -rf .cache",
      decisions: ["allow-once", "deny"],
      requestedAt: new Date().toISOString(),
    });
    expect(agents.list()[0]?.state).toBe("awaiting-approval");
    await expect(agents.answer(id, "ap1", "allow-session")).rejects.toThrow(AgentError);
    await agents.answer(id, "ap1", "deny");
    expect(fake.answers).toEqual([{ approvalId: "ap1", decision: "deny" }]);
    expect(agents.list()[0]?.state).toBe("running");
    expect(agents.snapshot(id).approvals).toHaveLength(0);
    await expect(agents.answer(id, "ap1", "deny")).rejects.toThrow("no longer waiting");
  });

  test("the first prompt names the session; later ones don't rename it", async () => {
    const agents = manager();
    const { id } = await agents.start({ provider: "fake" });
    const first = await promptTurn(agents, id, { text: "Make the hero taller\nand more" });
    expect(agents.list()[0]?.title).toBe("Make the hero taller");
    await agents.prompt(id, { text: "Then say bye." });
    sink().turnCompleted(first, "completed");
    await Bun.sleep(0);
    expect(agents.list()[0]?.title).toBe("Make the hero taller");
  });

  test("a session continued from outside the tab is offered once, then named by its first prompt", async () => {
    const agents = manager();
    const updatedAt = new Date().toISOString();
    fake.history = async () => [
      { providerSessionId: "outside", title: "Fix the header", updatedAt },
      { providerSessionId: "fake-1", title: "Started in the tab", updatedAt },
    ];
    await agents.start({ provider: "fake" });
    expect((await agents.history("fake")).map((e) => e.providerSessionId)).toEqual(["outside"]);

    const { id } = await agents.start({ provider: "fake", resume: "outside" });
    expect(fake.launches.at(-1)?.resume).toBe("outside");
    sink().history([
      {
        id: "t-0",
        status: "completed",
        startedAt: updatedAt,
        items: [{ kind: "user", id: "u-1", text: "Fix the header\nand the footer" }],
      },
    ]);
    expect(agents.snapshot(id).turns).toHaveLength(1);
    expect(agents.list().find((s) => s.id === id)?.title).toBe("Fix the header");
    expect(await agents.history("fake")).toEqual([]);
  });

  test("a follow-up while a turn runs is queued, then sent when it ends", async () => {
    const agents = manager();
    const { id } = await agents.start({ provider: "fake" });
    const first = await promptTurn(agents, id, { text: "one" });
    const second = await agents.prompt(id, { text: "two" });
    expect(second.mode).toBe("queued");
    expect(agents.snapshot(id).queued.map((q) => q.text)).toEqual(["two"]);
    sink().turnCompleted(first, "completed");
    await Bun.sleep(0);
    expect(fake.turns).toEqual(["one", "two"]);
    expect(agents.snapshot(id).queued).toEqual([]);
  });

  test("a queued follow-up can be withdrawn", async () => {
    const agents = manager();
    const { id } = await agents.start({ provider: "fake" });
    const first = await promptTurn(agents, id, { text: "one" });
    await agents.prompt(id, { text: "two" });
    agents.dequeue(id, agents.snapshot(id).queued[0]?.id ?? "");
    sink().turnCompleted(first, "completed");
    await Bun.sleep(0);
    expect(fake.turns).toEqual(["one"]);
  });

  test("a provider that steers gets the follow-up inside the running turn", async () => {
    fake.capabilities = { ...fake.capabilities, followUp: "steer" };
    const agents = manager();
    const { id } = await agents.start({ provider: "fake" });
    const first = await promptTurn(agents, id, { text: "one" });
    const second = await agents.prompt(id, { text: "also this" });
    expect(second).toEqual({ mode: "steered", turnId: first });
    expect(fake.steered).toEqual(["also this"]);
    expect(agents.snapshot(id).turns[0]?.items.filter((i) => i.kind === "user")).toHaveLength(2);
  });

  test("interrupt ends the running turn", async () => {
    const agents = manager();
    const { id } = await agents.start({ provider: "fake" });
    const turnId = await promptTurn(agents, id, { text: "go" });
    await agents.interrupt(id);
    expect(fake.interrupted).toEqual([turnId]);
    expect(agents.snapshot(id).turns[0]?.status).toBe("interrupted");
    expect(agents.list()[0]?.state).toBe("idle");
  });

  test("a crash fails the running turn, clears approvals and stays reopenable", async () => {
    const agents = manager();
    const { id } = await agents.start({ provider: "fake" });
    const turnId = await promptTurn(agents, id, { text: "go" });
    sink().approval({
      id: "ap",
      turnId: turnId,
      kind: "tool",
      title: "Use a tool",
      decisions: ["deny"],
      requestedAt: new Date().toISOString(),
    });
    sink().exited("segfault");
    const snap = agents.snapshot(id);
    expect(snap.session.state).toBe("failed");
    expect(snap.session.stateMessage).toContain("segfault");
    expect(snap.turns[0]?.status).toBe("failed");
    expect(snap.approvals).toEqual([]);
    expect(agents.liveCount()).toBe(0);
    await expect(agents.prompt(id, { text: "again" })).rejects.toThrow("isn't running");
    const reopened = await agents.reopen(id);
    expect(reopened.state).toBe("idle");
    expect(fake.launches.at(-1)?.resume).toBe("fake-1");
  });

  test("late events from a replaced process are ignored", async () => {
    const agents = manager();
    const { id } = await agents.start({ provider: "fake" });
    const oldSink = sink();
    await agents.terminate(id);
    await agents.reopen(id);
    oldSink.titled("stale");
    oldSink.exited("late");
    expect(agents.list()[0]?.title).toBe("New session");
    expect(agents.list()[0]?.state).toBe("idle");
  });

  test("terminating stops the process and keeps the transcript", async () => {
    const agents = manager();
    const { id } = await agents.start({ provider: "fake" });
    await agents.prompt(id, { text: "hello" });
    await agents.terminate(id);
    expect(fake.closed).toBe(1);
    const snap = agents.snapshot(id);
    expect(snap.session.state).toBe("exited");
    expect(snap.turns[0]?.status).toBe("interrupted");
  });

  test("a failed start is reported on the session, with the provider's reason", async () => {
    fake.failStart = new Error("Not signed in. Run `fake login`.");
    const agents = manager();
    await expect(agents.start({ provider: "fake" })).rejects.toThrow("fake login");
    expect(agents.list()[0]).toMatchObject({
      state: "failed",
      stateMessage: "Not signed in. Run `fake login`.",
    });
  });

  test("a provider that isn't ready can't start, and says why", async () => {
    fake.info = { status: "logged-out", message: "Run `fake login` in a terminal." };
    const agents = manager();
    await expect(agents.start({ provider: "fake" })).rejects.toThrow("fake login");
    expect(agents.list()).toEqual([]);
  });

  test("long command output keeps its tail and counts what it dropped", async () => {
    const agents = manager();
    const { id } = await agents.start({ provider: "fake" });
    const turnId = await promptTurn(agents, id, { text: "test" });
    sink().item(turnId, {
      kind: "command",
      id: "c",
      command: "bun test",
      status: "running",
      output: "",
    });
    const chunk = "x".repeat(10_000);
    for (let i = 0; i < 10; i++) sink().delta(turnId, "c", "output", chunk);
    sink().delta(turnId, "c", "output", "END");
    const item = agents.snapshot(id).turns[0]?.items[1];
    expect(item?.kind).toBe("command");
    if (item?.kind !== "command") return;
    expect(item.output.length).toBe(LIMITS.output);
    expect(item.output.endsWith("END")).toBe(true);
    expect(item.outputDropped).toBe(100_003 - LIMITS.output);
  });

  test("a long conversation keeps its newest turns, and a snapshot pages the rest", async () => {
    const agents = manager();
    const { id } = await agents.start({ provider: "fake" });
    for (let i = 0; i < LIMITS.turns + 5; i++) {
      const turnId = await promptTurn(agents, id, { text: `turn ${i}` });
      sink().turnCompleted(turnId, "completed");
    }
    const snap = agents.snapshot(id);
    expect(snap.turns).toHaveLength(LIMITS.snapshotTurns);
    expect(snap.turnsDropped).toBe(LIMITS.turns + 5 - LIMITS.snapshotTurns);
    expect(snap.turns.at(-1)?.items[0]).toMatchObject({ text: `turn ${LIMITS.turns + 4}` });
  });

  test("a runaway turn keeps its prompt and its latest work", async () => {
    const agents = manager();
    const { id } = await agents.start({ provider: "fake" });
    const turnId = await promptTurn(agents, id, { text: "loop" });
    for (let i = 0; i < LIMITS.items + 50; i++) {
      sink().item(turnId, {
        kind: "command",
        id: `c${i}`,
        command: `step ${i}`,
        status: "completed",
        output: "",
      });
    }
    const items = agents.snapshot(id).turns[0]?.items ?? [];
    expect(items).toHaveLength(LIMITS.items);
    expect(items[0]).toMatchObject({ kind: "user", text: "loop" });
    expect(items.at(-1)).toMatchObject({ command: `step ${LIMITS.items + 49}` });
  });

  test("history persists without raw payloads, and a restart reports sessions as reopenable", async () => {
    const agents = manager();
    const { id } = await agents.start({ provider: "fake" });
    const turnId = await promptTurn(agents, id, { text: "persist me" });
    sink().item(turnId, { kind: "agent-text", id: "a", text: "Saved." });
    await settle();

    const files = await readdir(dir);
    expect(files).toEqual([`${id}.json`]);
    const stored = JSON.parse(await readFile(join(dir, `${id}.json`), "utf8"));
    expect(Object.keys(stored).sort()).toEqual(["session", "turns", "turnsDropped", "version"]);

    const next = manager(new FakeAgentAdapter());
    await next.load();
    const snap = next.snapshot(id);
    expect(snap.session.state).toBe("exited");
    expect(snap.session.stateMessage).toContain("Reopen");
    expect(snap.turns[0]?.status).toBe("interrupted");
    expect(snap.turns[0]?.items.map((i) => i.kind)).toEqual(["user", "agent-text"]);
    expect(next.liveCount()).toBe(0);
  });

  test("removing a session deletes its history from this machine", async () => {
    const agents = manager();
    const { id } = await agents.start({ provider: "fake" });
    await settle();
    await agents.remove(id);
    expect(await readdir(dir)).toEqual([]);
    expect(frames.at(-1)).toMatchObject({ event: "session-removed", sessionId: id });
  });

  test("stopping or removing a session that is still starting closes its process once it's up", async () => {
    const agents = manager();
    for (const stop of ["terminate", "remove"] as const) {
      let up = () => {};
      fake.startGate = new Promise((resolve) => {
        up = resolve;
      });
      const starting = agents.start({ provider: "fake" });
      await Bun.sleep(0);
      const id = agents.list().find((s) => s.state === "starting")?.id ?? "";
      expect(agents.liveCount()).toBe(1);
      const stopped = agents[stop](id);
      up();
      await starting;
      await stopped;
      expect(agents.liveCount()).toBe(0);
      if (stop === "terminate") expect(agents.snapshot(id).session.state).toBe("exited");
      else expect(agents.list().some((s) => s.id === id)).toBe(false);
    }
    expect(fake.closed).toBe(2);
  });

  test("only a session at work keeps the daemon awake — not an idle one, nor one waiting on a person", async () => {
    const agents = manager();
    let up = () => {};
    fake.startGate = new Promise((resolve) => {
      up = resolve;
    });
    const starting = agents.start({ provider: "fake" });
    await Bun.sleep(0);
    expect(agents.busyCount()).toBe(1);
    up();
    const { id } = await starting;
    expect(agents.busyCount()).toBe(0);
    expect(agents.liveCount()).toBe(1);

    const turnId = await promptTurn(agents, id, { text: "rm the cache" });
    expect(agents.busyCount()).toBe(1);
    sink().approval({
      id: "ap1",
      turnId,
      kind: "command",
      title: "Run a command",
      decisions: ["allow-once", "deny"],
      requestedAt: new Date().toISOString(),
    });
    expect(agents.busyCount()).toBe(0);
    await agents.answer(id, "ap1", "allow-once");
    expect(agents.busyCount()).toBe(1);
    sink().turnCompleted(turnId, "completed");
    expect(agents.busyCount()).toBe(0);
    await agents.closeAll();
  });

  test("closeAll stops every process", async () => {
    const agents = manager();
    await agents.start({ provider: "fake" });
    await agents.start({ provider: "fake" });
    await agents.closeAll();
    expect(fake.closed).toBe(2);
    expect(agents.liveCount()).toBe(0);
  });
});

describe("the edges of a session", () => {
  test("a provider whose discovery throws is listed with what went wrong", async () => {
    fake.discover = async () => {
      throw new Error("spawn EACCES");
    };
    const providers = await manager().providers(true);
    expect(providers).toEqual([
      expect.objectContaining({ id: "fake", status: "error", message: "spawn EACCES" }),
    ]);
  });

  test("history comes from the provider, or is empty when it keeps none", async () => {
    expect(await manager().history("fake")).toEqual([]);
    fake.history = async (cwd: string) => [
      { providerSessionId: "p1", title: cwd, updatedAt: "2026-01-01" },
    ];
    expect(await manager().history("fake")).toEqual([
      { providerSessionId: "p1", title: "/app", updatedAt: "2026-01-01" },
    ]);
    await expect(manager().history("nobody")).rejects.toThrow("Unknown agent provider");
  });

  test("a name the person gives sticks, whatever they send next", async () => {
    const agents = manager();
    const { id } = await agents.start({ provider: "fake" });
    await agents.rename(id, "Pricing pass");
    await agents.prompt(id, { text: "Make it taller" });
    expect(agents.list()[0]?.title).toBe("Pricing pass");
  });

  test("a session that can't be reopened says so, and so does an empty prompt", async () => {
    const agents = manager();
    const { id } = await agents.start({ provider: "fake" });
    await expect(agents.prompt(id, { text: "   " })).rejects.toThrow("nothing to send");
    sink().ready({
      environment: { execution: "local", host: "h", cwd: "/app", sandbox: "s", approvalMode: "a" },
      resumable: false,
    });
    await agents.terminate(id);
    await expect(agents.reopen(id)).rejects.toThrow("can't be reopened");
  });

  test("a provider that can't follow up refuses a second prompt while it works", async () => {
    fake.capabilities = { ...fake.capabilities, followUp: "none" };
    const agents = manager();
    const { id } = await agents.start({ provider: "fake" });
    await agents.prompt(id, { text: "one" });
    await expect(agents.prompt(id, { text: "two" })).rejects.toThrow("Wait for the current turn");
  });

  test("no more than four agents run at once", async () => {
    const agents = manager();
    for (let i = 0; i < 4; i++) await agents.start({ provider: "fake" });
    await expect(agents.start({ provider: "fake" })).rejects.toThrow("Too many agent sessions");
    expect(agents.liveCount()).toBe(4);
    await agents.closeAll();
  });

  test("the daemon offers Codex, Claude Code and the Agent Client Protocol agents, in that order", async () => {
    const { defaultAgentAdapters } = await import("../agent/registry.ts");
    expect(defaultAgentAdapters().map((a) => a.id)).toEqual([
      "codex",
      "claude-code",
      "opencode",
      "github-copilot",
      "cursor",
      "gemini",
      "qwen-code",
      "kimi",
      "mistral-vibe",
      "cline",
      "kilo",
      "auggie",
      "factory-droid",
      "goose",
    ]);
  });
});

describe("the agent routes", () => {
  const call = (
    app: ReturnType<typeof createAgentRouter>,
    method: string,
    path: string,
    body?: unknown,
  ) =>
    app.request(path, {
      method,
      headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  test("a start body can't name a directory, an executable or a sandbox", async () => {
    const app = createAgentRouter(manager());
    for (const extra of [
      { cwd: "/" },
      { executable: "/bin/sh" },
      { sandbox: "danger-full-access" },
      { env: {} },
    ]) {
      const res = await call(app, "POST", "/sessions", { provider: "fake", ...extra });
      expect(res.status).toBe(400);
    }
    expect(fake.launches).toEqual([]);
  });

  test("start, prompt, snapshot and stop through HTTP", async () => {
    const app = createAgentRouter(manager());
    const started = await call(app, "POST", "/sessions", { provider: "fake" });
    expect(started.status).toBe(200);
    const { session } = (await started.json()) as { session: { id: string } };
    const prompted = await call(app, "POST", `/sessions/${session.id}/turns`, { text: "hi" });
    expect(await prompted.json()).toMatchObject({ mode: "started" });
    const snap = (await (await call(app, "GET", `/sessions/${session.id}`)).json()) as {
      turns: unknown[];
    };
    expect(snap.turns).toHaveLength(1);
    expect((await call(app, "POST", `/sessions/${session.id}/stop`)).status).toBe(200);
    expect(fake.closed).toBe(1);
  });

  test("every session operation is reachable over HTTP", async () => {
    const agents = manager();
    const app = createAgentRouter(agents);
    const { session } = (await (
      await call(app, "POST", "/sessions", { provider: "fake" })
    ).json()) as {
      session: { id: string };
    };
    const id = session.id;
    expect((await (await call(app, "GET", "/sessions")).json()) as unknown).toMatchObject({
      sessions: [{ id }],
    });
    expect((await call(app, "GET", "/history?provider=fake")).status).toBe(200);
    expect(
      (
        (await (await call(app, "PATCH", `/sessions/${id}`, { title: "Named" })).json()) as {
          session: { title: string };
        }
      ).session.title,
    ).toBe("Named");
    await call(app, "POST", `/sessions/${id}/turns`, { text: "one" });
    await call(app, "POST", `/sessions/${id}/turns`, { text: "two" });
    const queued = agents.snapshot(id).queued[0]?.id ?? "";
    expect((await call(app, "DELETE", `/sessions/${id}/queue/${queued}`)).status).toBe(200);
    expect(agents.snapshot(id).queued).toEqual([]);
    expect((await call(app, "POST", `/sessions/${id}/interrupt`)).status).toBe(200);
    expect((await call(app, "POST", `/sessions/${id}/stop`)).status).toBe(200);
    expect((await call(app, "POST", `/sessions/${id}/reopen`)).status).toBe(200);
    expect(
      (await call(app, "POST", `/sessions/${id}/approvals/none`, { decision: "deny" })).status,
    ).toBe(404);
    expect((await call(app, "DELETE", `/sessions/${id}`)).status).toBe(200);
    expect(agents.list()).toEqual([]);
  });

  test("/model and /mcp go through HTTP, with strict bodies", async () => {
    fake.controls = {
      commands: [{ name: "review" }],
      models: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ],
      model: "a",
      modes: [{ id: "ask", label: "Ask" }],
      mode: "ask",
      mcp: { actions: ["reconnect"] },
    };
    fake.mcp = [
      { name: "velloo", status: "connected", tools: 3 },
      { name: "docs", status: "failed", detail: "timed out" },
    ];
    const agents = manager();
    const app = createAgentRouter(agents);
    const { session } = (await (
      await call(app, "POST", "/sessions", { provider: "fake" })
    ).json()) as { session: { id: string } };
    const id = session.id;
    expect(frames.some((f) => f.event === "controls" && f.controls?.model === "a")).toBe(true);
    expect(agents.snapshot(id).controls?.commands).toEqual([{ name: "review" }]);

    const switched = await call(app, "POST", `/sessions/${id}/model`, { model: "b" });
    expect(
      ((await switched.json()) as { session: AgentSessionSummary }).session.environment?.model,
    ).toBe("b-resolved");
    expect(agents.snapshot(id).controls?.model).toBe("b");
    expect(fake.models).toEqual(["b"]);
    expect((await call(app, "POST", `/sessions/${id}/model`, { model: "z" })).status).toBe(400);
    expect(
      (await call(app, "POST", `/sessions/${id}/model`, { model: "b", cwd: "/" })).status,
    ).toBe(400);

    const moded = await call(app, "POST", `/sessions/${id}/mode`, { mode: "ask" });
    expect(
      ((await moded.json()) as { session: AgentSessionSummary }).session.environment?.sandbox,
    ).toBe("ask");
    expect(fake.modeChanges).toEqual(["ask"]);
    expect((await call(app, "POST", `/sessions/${id}/mode`, { mode: "bypass" })).status).toBe(400);
    expect(
      (await call(app, "POST", `/sessions/${id}/mode`, { mode: "ask", sandbox: "x" })).status,
    ).toBe(400);

    const listed = (await (await call(app, "GET", `/sessions/${id}/mcp`)).json()) as {
      servers: { name: string; velloo?: boolean }[];
    };
    expect(listed.servers.map((s) => [s.name, s.velloo])).toEqual([
      ["velloo", true],
      ["docs", undefined],
    ]);
    expect(
      (await call(app, "POST", `/sessions/${id}/mcp`, { server: "docs", action: "reconnect" }))
        .status,
    ).toBe(200);
    expect(fake.mcpActions).toEqual([{ server: "docs", action: "reconnect" }]);
    // Offered actions only, and nothing but a server and an action.
    expect(
      (await call(app, "POST", `/sessions/${id}/mcp`, { server: "docs", action: "disable" }))
        .status,
    ).toBe(400);
    expect(
      (
        await call(app, "POST", `/sessions/${id}/mcp`, {
          server: "docs",
          action: "reconnect",
          command: "rm",
        })
      ).status,
    ).toBe(400);

    await call(app, "POST", `/sessions/${id}/stop`);
    expect(frames.some((f) => f.event === "controls" && f.controls === null)).toBe(true);
    expect(agents.snapshot(id).controls).toBeUndefined();
    expect((await call(app, "GET", `/sessions/${id}/mcp`)).status).toBe(400);
  });

  test("errors map to statuses", async () => {
    const app = createAgentRouter(manager());
    expect((await call(app, "GET", "/sessions/nope")).status).toBe(404);
    expect((await call(app, "POST", "/sessions", { provider: "nobody" })).status).toBe(404);
    expect((await call(app, "POST", "/sessions", "not json")).status).toBe(400);
  });

  test("without agents the API answers but offers nothing", async () => {
    const res = await call(createAgentRouter(undefined), "GET", "/providers");
    expect(res.status).toBe(404);
  });
});
