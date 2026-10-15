import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentFrame } from "@velloo/protocol/agent";
import { CodexAdapter } from "../agent/codex/adapter.ts";
import { displayCommand, normalizeItem } from "../agent/codex/normalize.ts";
import { AgentSessionManager } from "../agent/sessions.ts";

const FAKE = join(import.meta.dir, "fixtures", "fake-codex.ts");
let dir: string;
let frames: AgentFrame[];

const adapter = () => new CodexAdapter({ command: [process.execPath, FAKE] });

function manager() {
  return new AgentSessionManager({
    adapters: [adapter()],
    broadcast: (frame) => frames.push(frame),
    launch: () => ({
      cwd: dir,
      mcp: { name: "velloo", url: "http://127.0.0.1:9/mcp", command: ["velloo", "mcp", "/design"] },
      instructions: "You are in the canvas.",
    }),
    storeDir: join(dir, "store"),
  });
}

async function until(check: () => boolean, ms = 5_000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out waiting");
    await Bun.sleep(10);
  }
}

async function requests(): Promise<{ method: string; params: Record<string, unknown> }[]> {
  const text = await readFile(join(dir, "requests.log"), "utf8").catch(() => "");
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "velloo-codex-"));
  frames = [];
  process.env.FAKE_CODEX_LOG = join(dir, "requests.log");
  delete process.env.FAKE_CODEX_MODE;
  delete process.env.FAKE_CODEX_CONFIG;
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("Codex discovery", () => {
  test("a signed-in, compatible Codex is ready, with capabilities from its own schema", async () => {
    const info = await adapter().discover();
    expect(info).toMatchObject({ status: "ready", version: "9.9.9", account: "ChatGPT Pro" });
    expect(info.capabilities).toMatchObject({ followUp: "steer", rename: true, history: true });
    expect(JSON.stringify(info)).not.toContain("someone@example.com");
  });

  test("a signed-out Codex says how to sign in", async () => {
    process.env.FAKE_CODEX_MODE = "logged-out";
    const info = await adapter().discover();
    expect(info.status).toBe("logged-out");
    expect(info.message).toContain("codex login");
  });

  test("a Codex missing a required method is incompatible, and says to upgrade", async () => {
    process.env.FAKE_CODEX_MODE = "old";
    const info = await adapter().discover();
    expect(info.status).toBe("incompatible");
    expect(info.message).toContain("turn/interrupt");
    expect(info.message).toContain("Upgrade");
  });
});

describe("Codex sessions", () => {
  test("starts a thread in the daemon's cwd, with an explicit policy and this design's MCP", async () => {
    process.env.FAKE_CODEX_CONFIG = JSON.stringify({
      mcp_servers: { velloo: { command: "velloo", args: ["mcp"] } },
    });
    const agents = manager();
    const session = await agents.start({ provider: "codex" });
    expect(session.environment).toMatchObject({
      execution: "local",
      cwd: dir,
      sandbox: "workspace-write",
      approvalMode: "on-request",
      providerVersion: "9.9.9",
    });
    expect(session.terminalCommand).toEqual(["codex", "resume", "t1"]);
    const start = (await requests()).find((r) => r.method === "thread/start");
    expect(start?.params).toMatchObject({
      cwd: dir,
      approvalPolicy: "on-request",
      sandbox: "workspace-write",
      developerInstructions: "You are in the canvas.",
      config: {
        "mcp_servers.velloo": { command: "velloo", args: ["mcp", "/design"], enabled: true },
      },
    });
    await agents.closeAll();
  });

  test("keeps the person's own stricter policy, and an HTTP entry stays HTTP", async () => {
    process.env.FAKE_CODEX_CONFIG = JSON.stringify({
      approval_policy: "untrusted",
      sandbox_mode: "read-only",
      mcp_servers: { velloo: { url: "http://old" } },
    });
    const agents = manager();
    await agents.start({ provider: "codex" });
    const start = (await requests()).find((r) => r.method === "thread/start");
    expect(start?.params).toMatchObject({
      approvalPolicy: "untrusted",
      sandbox: "read-only",
      config: { "mcp_servers.velloo": { url: "http://127.0.0.1:9/mcp", enabled: true } },
    });
    await agents.closeAll();
  });

  test("streams a turn and ends it", async () => {
    const agents = manager();
    const { id } = await agents.start({ provider: "codex" });
    await agents.prompt(id, { text: "hello" });
    await until(() => agents.snapshot(id).turns[0]?.status === "completed");
    const turn = agents.snapshot(id).turns[0];
    expect(turn?.items.map((i) => i.kind)).toEqual(["user", "agent-text"]);
    expect(turn?.items[1]).toMatchObject({ text: "Working", phase: "final" });
    expect(frames.some((f) => f.event === "delta")).toBe(true);
    await agents.closeAll();
  });

  test("an approval reaches the person and their decline goes back to Codex", async () => {
    const agents = manager();
    const { id } = await agents.start({ provider: "codex" });
    await agents.prompt(id, { text: "please approve this" });
    await until(() => agents.snapshot(id).approvals.length === 1);
    const [request] = agents.snapshot(id).approvals;
    expect(request).toMatchObject({
      kind: "command",
      command: "rm -rf build",
      cwd: "/app",
      reason: "Deletes files",
      decisions: ["allow-once", "allow-session", "deny", "abort"],
    });
    await agents.answer(id, request?.id ?? "", "deny");
    await until(() => agents.snapshot(id).turns[0]?.status === "completed");
    const command = agents.snapshot(id).turns[0]?.items.find((i) => i.kind === "command");
    expect(command).toMatchObject({ status: "declined" });
    await agents.closeAll();
  });

  test("an MCP server's yes/no question can be allowed; a form asking for values can only be declined", async () => {
    const agents = manager();
    const { id } = await agents.start({ provider: "codex" });
    await agents.prompt(id, { text: "elicit" });
    await until(() => agents.snapshot(id).approvals.length === 1);
    const [question] = agents.snapshot(id).approvals;
    expect(question).toMatchObject({
      kind: "tool",
      title: 'Allow Computer Use to use "Google Chrome"?',
      reason: "Asked by the computer-use MCP server.",
      decisions: ["allow-once", "deny", "abort"],
    });
    await agents.answer(id, question?.id ?? "", "allow-once");
    await until(() => agents.snapshot(id).turns[0]?.status === "completed");
    const answered = (await requests()) as unknown as { elicitationAnswer?: unknown }[];
    expect(answered.find((r) => r.elicitationAnswer)?.elicitationAnswer).toEqual({
      action: "accept",
      content: {},
      _meta: null,
    });

    await agents.prompt(id, { text: "elicit form" });
    await until(() => agents.snapshot(id).approvals.length === 1);
    expect(agents.snapshot(id).approvals[0]?.decisions).toEqual(["deny", "abort"]);
    await agents.closeAll();
  });

  test("overload is retried instead of failing the turn", async () => {
    process.env.FAKE_CODEX_MODE = "overload-once";
    const agents = manager();
    const { id } = await agents.start({ provider: "codex" });
    const result = await agents.prompt(id, { text: "hello" });
    expect(result.mode).toBe("started");
    expect((await requests()).filter((r) => r.method === "turn/start")).toHaveLength(2);
    await agents.closeAll();
  });

  test("a malformed line is skipped with a warning, and the session carries on", async () => {
    process.env.FAKE_CODEX_MODE = "malformed";
    const agents = manager();
    const { id } = await agents.start({ provider: "codex" });
    await agents.prompt(id, { text: "hello" });
    await until(() => agents.snapshot(id).turns[0]?.status === "completed");
    const notice = agents.snapshot(id).turns[0]?.items.find((i) => i.kind === "notice");
    expect(notice).toMatchObject({ level: "warning" });
    await agents.closeAll();
  });

  test("a crash fails the session with Codex's own last words", async () => {
    process.env.FAKE_CODEX_MODE = "crash-on-turn";
    const agents = manager();
    const { id } = await agents.start({ provider: "codex" });
    await expect(agents.prompt(id, { text: "hello" })).rejects.toThrow();
    await until(() => agents.snapshot(id).session.state === "failed");
    expect(agents.snapshot(id).session.stateMessage).toContain("the model is unavailable");
    expect(agents.liveCount()).toBe(0);
  });

  test("reopening resumes the thread and brings back its history", async () => {
    const agents = manager();
    const session = await agents.start({ provider: "codex", resume: "t-old" });
    const snap = agents.snapshot(session.id);
    expect(snap.session.providerSessionId).toBe("t-old");
    expect(snap.turns[0]?.items.map((i) => i.kind)).toEqual(["user", "agent-text"]);
    expect((await requests()).some((r) => r.method === "thread/resume")).toBe(true);

    await agents.terminate(session.id);
    expect(agents.snapshot(session.id).session.state).toBe("exited");
    const reopened = await agents.reopen(session.id);
    expect(reopened.state).toBe("idle");
    await agents.closeAll();
  });

  test("interrupt ends the running turn", async () => {
    const agents = manager();
    const { id } = await agents.start({ provider: "codex" });
    await agents.prompt(id, { text: "please approve this" });
    await until(() => agents.snapshot(id).approvals.length === 1);
    await agents.interrupt(id);
    await until(() => agents.snapshot(id).turns[0]?.status === "interrupted");
    expect(agents.snapshot(id).approvals).toEqual([]);
    await agents.closeAll();
  });

  test("lists the threads Codex kept for this directory", async () => {
    const history = await adapter().history(dir);
    expect(history).toEqual([
      {
        providerSessionId: "t-old",
        title: "An earlier thread",
        updatedAt: new Date(1_700_000_000_000).toISOString(),
      },
    ]);
  });
});

describe("Codex normalization", () => {
  test("strips the login-shell wrapper from a command", () => {
    expect(displayCommand("/bin/zsh -lc 'npm test'")).toBe("npm test");
    expect(displayCommand("/bin/bash -lc ls")).toBe("ls");
    expect(displayCommand("git status")).toBe("git status");
  });

  test("an MCP tool call keeps its server and a short rendering of its result", () => {
    expect(
      normalizeItem({
        type: "mcpToolCall",
        id: "x",
        server: "velloo",
        tool: "compose",
        status: "completed",
        arguments: { screen: "home" },
        result: { content: [{ type: "text", text: "Composed 4 nodes." }] },
      }),
    ).toEqual({
      kind: "tool",
      id: "x",
      name: "compose",
      server: "velloo",
      status: "completed",
      input: '{\n  "screen": "home"\n}',
      output: "Composed 4 nodes.",
    });
  });

  test("a file change keeps each path, its kind and its diff", () => {
    expect(
      normalizeItem({
        type: "fileChange",
        id: "f",
        status: "completed",
        changes: [
          {
            path: "src/a.tsx",
            kind: { type: "update", move_path: null },
            diff: "@@ -1 +1 @@\n-a\n+b",
          },
          { path: "src/new.ts", kind: { type: "add" }, diff: "+x" },
        ],
      }),
    ).toEqual({
      kind: "file-change",
      id: "f",
      status: "completed",
      changes: [
        { path: "src/a.tsx", change: "update", diff: "@@ -1 +1 @@\n-a\n+b" },
        { path: "src/new.ts", change: "add", diff: "+x" },
      ],
    });
  });

  test("a failed command is failed even when Codex calls it completed", () => {
    expect(
      normalizeItem({
        type: "commandExecution",
        id: "c",
        command: "false",
        status: "completed",
        exitCode: 1,
      }),
    ).toMatchObject({ status: "failed", exitCode: 1 });
  });

  test("unknown item kinds are skipped, not crashed on", () => {
    expect(normalizeItem({ type: "somethingNew", id: "y" })).toBeNull();
    expect(normalizeItem(null)).toBeNull();
  });
});
