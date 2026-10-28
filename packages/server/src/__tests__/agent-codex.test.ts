import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentFrame } from "@velloo/protocol/agent";
import { CodexAdapter } from "../agent/codex/adapter.ts";
import {
  approvalLabel,
  displayCommand,
  normalizeItem,
  sandboxLabel,
} from "../agent/codex/normalize.ts";
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
      decisions: ["allow-once", "allow-session", "allow-always", "deny", "abort"],
      always:
        "Don't ask again for commands that start with `rm -rf build` — saved to your Codex rules.",
    });
    await agents.answer(id, request?.id ?? "", "deny");
    await until(() => agents.snapshot(id).turns[0]?.status === "completed");
    const command = agents.snapshot(id).turns[0]?.items.find((i) => i.kind === "command");
    expect(command).toMatchObject({ status: "declined" });
    await agents.closeAll();
  });

  test("always allow answers with the rule Codex proposed", async () => {
    const agents = manager();
    const { id } = await agents.start({ provider: "codex" });
    await agents.prompt(id, { text: "please approve this" });
    await until(() => agents.snapshot(id).approvals.length === 1);
    await agents.answer(id, agents.snapshot(id).approvals[0]?.id ?? "", "allow-always");
    await until(() => agents.snapshot(id).turns[0]?.status === "completed");
    const logged = (await Bun.file(process.env.FAKE_CODEX_LOG ?? "").text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { commandAnswer?: unknown });
    expect(logged.find((l) => l.commandAnswer)?.commandAnswer).toEqual({
      decision: { acceptWithExecpolicyAmendment: { execpolicy_amendment: ["rm", "-rf", "build"] } },
    });
    const command = agents.snapshot(id).turns[0]?.items.find((i) => i.kind === "command");
    expect(command).toMatchObject({ status: "completed" });
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

  test("Codex's notices, title, plan and diff reach the session; another thread's events don't", async () => {
    const agents = manager();
    const { id } = await agents.start({ provider: "codex" });
    await agents.prompt(id, { text: "notify" });
    await until(() => agents.snapshot(id).turns[0]?.status === "completed");
    const snap = agents.snapshot(id);
    expect(snap.session.title).toBe("Named by Codex");
    const notices = (snap.turns[0]?.items ?? []).flatMap((i) =>
      i.kind === "notice" ? [`${i.level}: ${i.text}`] : [],
    );
    expect(notices).toEqual([
      "warning: Slow network",
      "warning: Rate limited Retrying…",
      "error: The Velloo MCP server didn't start in Codex: spawn ENOENT Design edits won't reach the canvas.",
      "error: Codex hit an internal error on this thread.",
    ]);
    expect(snap.turns[0]?.items.find((i) => i.kind === "plan")).toMatchObject({
      steps: [{ text: "Look", status: "in-progress" }],
    });
    expect(snap.turns[0]?.diff).toBe("diff --git a/x b/x");
    await agents.closeAll();
  });

  test("more access, a question and an unknown request each get the right answer", async () => {
    const agents = manager();
    const { id } = await agents.start({ provider: "codex" });
    await agents.prompt(id, { text: "asks" });
    await until(() => agents.snapshot(id).approvals.length === 1);
    const access = agents.snapshot(id).approvals[0];
    expect(access).toMatchObject({
      kind: "permissions",
      title: "Grant more access",
      reason: "Needs network",
      decisions: ["allow-once", "allow-session", "deny"],
    });
    await agents.answer(id, access?.id ?? "", "allow-session");
    await until(() => agents.snapshot(id).approvals[0]?.kind === "question");
    const question = agents.snapshot(id).approvals[0];
    expect(question).toMatchObject({
      title: "Which colour?",
      decisions: ["allow-once", "deny"],
      questions: [
        {
          id: "a",
          header: "Pick",
          question: "Which colour?",
          options: [{ label: "Red", description: "Warm" }],
          other: true,
        },
        { id: "b", header: "Size", question: "How big?", options: [], other: true },
        { id: "c", question: "Your token?", options: [], other: true, secret: true },
      ],
    });
    await agents.answer(id, question?.id ?? "", "allow-once", {
      a: ["Red"],
      b: ["Huge"],
      c: ["s3cret"],
    });
    await until(() => agents.snapshot(id).turns[0]?.status === "completed");
    const log = (await requests()) as unknown as {
      askAnswer?: { method: string; result: unknown };
      toolCallAnswer?: { error?: { code: number } };
    }[];
    expect(log.filter((l) => l.askAnswer).map((l) => l.askAnswer)).toEqual([
      {
        method: "item/permissions/requestApproval",
        result: { permissions: { network: { enabled: true } }, scope: "session" },
      },
      {
        method: "item/tool/requestUserInput",
        result: {
          answers: {
            a: { answers: ["Red"] },
            b: { answers: ["Huge"] },
            c: { answers: ["s3cret"] },
          },
        },
      },
    ]);
    expect(log.find((l) => l.toolCallAnswer)?.toolCallAnswer?.error?.code).toBe(-32601);
    await agents.closeAll();
  });

  test("a request Codex withdraws leaves the person's queue", async () => {
    const agents = manager();
    const { id } = await agents.start({ provider: "codex" });
    await agents.prompt(id, { text: "withdraw" });
    await until(() => agents.snapshot(id).turns[0]?.status === "completed");
    expect(agents.snapshot(id).approvals).toEqual([]);
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

describe("Codex's slash commands", () => {
  test("/model offers Codex's visible models and sends the choice with the next turn", async () => {
    const agents = manager();
    const { id } = await agents.start({ provider: "codex" });
    const controls = agents.snapshot(id).controls;
    expect(controls).toMatchObject({
      commands: [],
      models: [
        { id: "fake-model", label: "Fake" },
        { id: "fast", label: "Fast", description: "Quick" },
      ],
      model: "fake-model",
      mcp: { actions: [] },
    });
    const session = await agents.setModel(id, "fast");
    expect(session.environment?.model).toBe("fake-fast");
    expect(frames.some((f) => f.event === "controls" && f.controls?.model === "fast")).toBe(true);
    await agents.prompt(id, { text: "hello" });
    await agents.prompt(id, { text: "again" }).catch(() => undefined);
    await until(() => agents.snapshot(id).turns.length >= 1);
    const turns = (await requests()).filter((r) => r.method === "turn/start");
    expect(turns[0]?.params.model).toBe("fake-fast");
    await expect(agents.mcpAction(id, "velloo", "reconnect")).rejects.toThrow("can't reconnect");
    await agents.closeAll();
  });

  test("its approval presets switch from the next turn; full access isn't offered", async () => {
    const agents = manager();
    const { id } = await agents.start({ provider: "codex" });
    const controls = agents.snapshot(id).controls;
    expect(controls?.modes?.map((m) => m.id)).toEqual(["read-only", "ask-first", "workspace"]);
    expect(controls?.mode).toBe("workspace");
    const session = await agents.setMode(id, "read-only");
    expect(session.environment).toMatchObject({ sandbox: "read-only", approvalMode: "on-request" });
    await agents.prompt(id, { text: "hello" });
    await until(() => agents.snapshot(id).turns[0]?.status === "completed");
    await agents.setMode(id, "ask-first");
    await agents.prompt(id, { text: "again" });
    await until(() => agents.snapshot(id).turns[1]?.status === "completed");
    await agents.prompt(id, { text: "once more" });
    await until(() => agents.snapshot(id).turns[2]?.status === "completed");
    const turns = (await requests()).filter((r) => r.method === "turn/start");
    expect(turns.map((t) => [t.params.approvalPolicy, t.params.sandboxPolicy])).toEqual([
      ["on-request", { type: "readOnly" }],
      // Back to the thread's own workspace sandbox, settings and all.
      ["untrusted", { type: "workspaceWrite" }],
      // Codex keeps a policy for later turns; Velloo sends it once.
      [undefined, undefined],
    ]);
    await expect(agents.setMode(id, "full-access")).rejects.toThrow("can't switch");
    await agents.closeAll();
  }, 20_000);

  test("/mcp reads every page of Codex's server status", async () => {
    const agents = manager();
    const { id } = await agents.start({ provider: "codex" });
    expect(await agents.mcpServers(id)).toEqual([
      { name: "velloo", status: "connected", tools: 2, velloo: true },
      { name: "backlog", status: "failed", detail: "exited with code 1", tools: 0 },
      { name: "figma", status: "needs-auth", detail: "Not signed in", tools: 0 },
    ]);
    await agents.closeAll();
  });

  test("a Codex without a model catalog or MCP status offers neither", async () => {
    process.env.FAKE_CODEX_MODE = "no-models";
    const agents = manager();
    const { id } = await agents.start({ provider: "codex" });
    expect(agents.snapshot(id).controls?.models).toEqual([]);
    await expect(agents.setModel(id, "fast")).rejects.toThrow("can't switch");
    await agents.closeAll();

    process.env.FAKE_CODEX_MODE = "no-catalog";
    const old = manager();
    const second = await old.start({ provider: "codex" });
    expect(old.snapshot(second.id).controls).toMatchObject({ commands: [], models: [] });
    expect(old.snapshot(second.id).controls?.mcp).toBeUndefined();
    await expect(old.mcpServers(second.id)).rejects.toThrow("doesn't report its MCP servers");
    await old.closeAll();
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

  test("every item kind Codex reports reads as what it is", () => {
    const cases: [unknown, unknown][] = [
      [
        { type: "plan", id: "p", text: "Do x" },
        { kind: "agent-text", id: "p", text: "Do x" },
      ],
      [
        { type: "reasoning", id: "r", summary: ["a", "b"] },
        { kind: "reasoning", id: "r", text: "a\n\nb" },
      ],
      [
        {
          type: "dynamicToolCall",
          id: "d",
          tool: "fetch",
          status: "completed",
          success: false,
          arguments: { url: "x" },
        },
        { kind: "tool", id: "d", name: "fetch", status: "failed", input: '{\n  "url": "x"\n}' },
      ],
      [
        { type: "webSearch", id: "w", query: "velloo" },
        { kind: "tool", id: "w", name: "Web search", status: "completed", input: "velloo" },
      ],
      [
        { type: "imageView", id: "i", path: "/a.png" },
        { kind: "tool", id: "i", name: "View image", status: "completed", input: "/a.png" },
      ],
      [
        { type: "collabAgentToolCall", id: "c", prompt: "Check tests", status: "interrupted" },
        { kind: "subagent", id: "c", description: "Check tests", status: "failed" },
      ],
      [
        { type: "contextCompaction", id: "k" },
        {
          kind: "notice",
          id: "k",
          level: "info",
          text: "Codex compacted the conversation to fit its context.",
        },
      ],
      [
        { type: "enteredReviewMode", id: "e" },
        { kind: "notice", id: "e", level: "info", text: "Started a review." },
      ],
      [
        { type: "exitedReviewMode", id: "x" },
        { kind: "notice", id: "x", level: "info", text: "Finished the review." },
      ],
      [
        {
          type: "mcpToolCall",
          id: "m",
          server: "velloo",
          tool: "compose",
          status: "failed",
          error: { message: "bad jsx" },
        },
        {
          kind: "tool",
          id: "m",
          name: "compose",
          server: "velloo",
          status: "failed",
          output: "bad jsx",
        },
      ],
    ];
    for (const [raw, expected] of cases) expect(normalizeItem(raw)).toEqual(expected as never);
    expect(
      normalizeItem({ type: "userMessage", id: "u", content: [{ type: "text", text: "hi" }] }),
    ).toBeNull();
    expect(
      normalizeItem(
        { type: "userMessage", id: "u", content: [{ type: "text", text: "hi" }] },
        { includeUser: true },
      ),
    ).toEqual({ kind: "user", id: "u", text: "hi" });
  });

  test("sandbox and approval policies read in Codex's own words", () => {
    expect(
      ["dangerFullAccess", "readOnly", "workspaceWrite", "externalSandbox"].map((type) =>
        sandboxLabel({ type }),
      ),
    ).toEqual(["danger-full-access", "read-only", "workspace-write", "external-sandbox"]);
    expect(sandboxLabel("custom")).toBe("custom");
    expect(sandboxLabel(null)).toBe("unknown");
    expect(approvalLabel("never")).toBe("never");
    expect(approvalLabel({ granular: {} })).toBe("granular");
    expect(approvalLabel(7)).toBe("unknown");
  });

  test("unknown item kinds are skipped, not crashed on", () => {
    expect(normalizeItem({ type: "somethingNew", id: "y" })).toBeNull();
    expect(normalizeItem(null)).toBeNull();
  });
});
