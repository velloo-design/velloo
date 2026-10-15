import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AgentFrame, parseAgentFrame } from "@velloo/protocol/agent";
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
    expect(frames.every((f) => f.type === "agent" && f.v === 1)).toBe(true);
  });

  test("a frame round-trips through the socket parsers", async () => {
    const agents = manager();
    await agents.start({ provider: "fake" });
    const wire = JSON.stringify(frames.at(-1));
    expect(parseSocketFrame(wire)?.type).toBe("agent");
    expect(parseAgentFrame(JSON.parse(wire))?.event).toBe("session");
    expect(parseAgentFrame({ type: "agent", v: 1, event: "nonsense" })).toBeNull();
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

  test("closeAll stops every process", async () => {
    const agents = manager();
    await agents.start({ provider: "fake" });
    await agents.start({ provider: "fake" });
    await agents.closeAll();
    expect(fake.closed).toBe(2);
    expect(agents.liveCount()).toBe(0);
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
