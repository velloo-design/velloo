import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClaudeCodeAdapter } from "../agent/claude/adapter.ts";
import { approvalFor, mcpTool, permissionChoices, toolUseItem } from "../agent/claude/normalize.ts";
import { AgentSessionManager } from "../agent/sessions.ts";

const FAKE = join(import.meta.dir, "fixtures", "fake-claude.ts");
let dir: string;

const adapter = () => new ClaudeCodeAdapter({ command: [process.execPath, FAKE] });

function manager() {
  return new AgentSessionManager({
    adapters: [adapter()],
    broadcast: () => undefined,
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

async function logged(): Promise<Record<string, unknown>[]> {
  const text = await readFile(join(dir, "claude.log"), "utf8").catch(() => "");
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "velloo-claude-"));
  process.env.FAKE_CLAUDE_LOG = join(dir, "claude.log");
  delete process.env.FAKE_CLAUDE_MODE;
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("Claude Code discovery", () => {
  test("a signed-in Claude Code is ready, labelled by plan and never by email", async () => {
    const info = await adapter().discover();
    expect(info).toMatchObject({ status: "ready", version: "2.1.300", account: "Claude Pro" });
    expect(info.capabilities).toMatchObject({ followUp: "queue", rename: false, interrupt: true });
    expect(JSON.stringify(info)).not.toContain("someone@example.com");
  });

  test("signed out says how to sign in", async () => {
    process.env.FAKE_CLAUDE_MODE = "logged-out";
    const info = await adapter().discover();
    expect(info.status).toBe("logged-out");
    expect(info.message).toContain("sign in");
  });

  test("a version without the flags Velloo needs is incompatible", async () => {
    process.env.FAKE_CLAUDE_MODE = "old";
    const info = await adapter().discover();
    expect(info.status).toBe("incompatible");
    expect(info.message).toContain("--session-id");
    expect(info.message).toContain("claude update");
  });
});

describe("Claude Code sessions", () => {
  test("launches in the daemon's cwd with this design's MCP, and no permission mode of Velloo's", async () => {
    const agents = manager();
    const session = await agents.start({ provider: "claude-code" });
    expect(session.environment).toMatchObject({
      cwd: dir,
      sandbox: "default",
      providerVersion: "2.1.300",
    });
    expect(session.terminalCommand).toEqual([
      "claude",
      "--resume",
      session.providerSessionId ?? "",
    ]);
    const argv = (await logged()).find((l) => l.argv)?.argv as string[];
    expect(argv).toContain("--session-id");
    expect(argv).toContain("stream-json");
    expect(
      argv.some((a) => a.includes("--permission-mode") || a.includes("skip-permissions")),
    ).toBe(false);
    const mcp = JSON.parse(argv[argv.indexOf("--mcp-config") + 1] ?? "{}");
    expect(mcp).toEqual({
      mcpServers: { velloo: { type: "http", url: "http://127.0.0.1:9/mcp" } },
    });
    expect(argv[argv.indexOf("--append-system-prompt") + 1]).toBe("You are in the canvas.");
    await agents.closeAll();
  });

  test("partial text streams into one item that the whole message then settles", async () => {
    const agents = manager();
    const { id } = await agents.start({ provider: "claude-code" });
    await agents.prompt(id, { text: "hello" });
    await until(() => agents.snapshot(id).turns[0]?.status === "completed");
    const items = agents.snapshot(id).turns[0]?.items ?? [];
    expect(items.map((i) => i.kind)).toEqual(["user", "agent-text"]);
    expect(items[1]).toMatchObject({ text: "Hello there" });
    expect(agents.snapshot(id).session.environment?.model).toBe("claude-test");
    await agents.closeAll();
  });

  test("commands and MCP tools settle with their results", async () => {
    const agents = manager();
    const { id } = await agents.start({ provider: "claude-code" });
    await agents.prompt(id, { text: "bash" });
    await until(() => agents.snapshot(id).turns[0]?.status === "completed");
    const items = agents.snapshot(id).turns[0]?.items ?? [];
    expect(items.find((i) => i.kind === "command")).toMatchObject({
      command: "echo hi",
      status: "completed",
      output: "hi",
    });
    expect(items.find((i) => i.kind === "tool")).toMatchObject({
      server: "velloo",
      name: "compose",
      status: "completed",
      output: "Composed.",
    });
    await agents.closeAll();
  });

  test("a permission prompt is the person's to answer; deny is reported as declined", async () => {
    const agents = manager();
    const { id } = await agents.start({ provider: "claude-code" });
    await agents.prompt(id, { text: "write" });
    await until(() => agents.snapshot(id).approvals.length === 1);
    const [request] = agents.snapshot(id).approvals;
    expect(request).toMatchObject({
      kind: "file-change",
      title: "Write a file",
      paths: ["/app/a.txt"],
    });
    await agents.answer(id, request?.id ?? "", "deny");
    await until(() => agents.snapshot(id).turns[0]?.status === "completed");
    const change = agents.snapshot(id).turns[0]?.items.find((i) => i.kind === "file-change");
    expect(change).toMatchObject({ status: "declined" });
    const permission = (await logged()).find((l) => l.permission)?.permission;
    expect(permission).toMatchObject({ behavior: "deny" });
    await agents.closeAll();
  });

  test("a question shows its options, and the person's answers go back in its input", async () => {
    const agents = manager();
    const { id } = await agents.start({ provider: "claude-code" });
    await agents.prompt(id, { text: "question" });
    await until(() => agents.snapshot(id).approvals.length === 1);
    const [request] = agents.snapshot(id).approvals;
    expect(request).toMatchObject({
      kind: "question",
      title: "Which colour?",
      decisions: ["allow-once", "deny"],
      questions: [
        {
          id: "Which colour?",
          header: "Colour",
          options: [
            { label: "Red", description: "Warm" },
            { label: "Blue", description: "Cool" },
          ],
          other: true,
        },
        { id: "Which sizes?", options: [{ label: "S" }, { label: "M" }], multiSelect: true },
      ],
    });
    expect(request?.always).toBeUndefined();
    await expect(
      agents.answer(id, request?.id ?? "", "allow-once", { "Which colour?": ["Red"] }),
    ).rejects.toThrow("Answer every question");
    await agents.answer(id, request?.id ?? "", "allow-once", {
      "Which colour?": ["Teal, please"],
      "Which sizes?": ["S", "M"],
      "Not asked": ["x"],
    });
    await until(() => agents.snapshot(id).turns[0]?.status === "completed");
    const permission = (await logged()).find((l) => l.permission)?.permission;
    expect(permission).toMatchObject({
      behavior: "allow",
      updatedInput: { answers: { "Which colour?": "Teal, please", "Which sizes?": "S, M" } },
    });
    expect(
      Object.keys((permission as { updatedInput: { answers: object } }).updatedInput.answers),
    ).toHaveLength(2);
    await agents.closeAll();
  });

  test("allow for this session scopes every rule Claude proposed to the session", async () => {
    const agents = manager();
    const { id } = await agents.start({ provider: "claude-code" });
    await agents.prompt(id, { text: "write" });
    await until(() => agents.snapshot(id).approvals.length === 1);
    const [request] = agents.snapshot(id).approvals;
    expect(request?.decisions).toEqual([
      "allow-once",
      "allow-session",
      "allow-always",
      "deny",
      "abort",
    ]);
    expect(request?.always).toBe(
      "Don't ask again for Write(a.txt) in this project, for you only (.claude/settings.local.json).",
    );
    await agents.answer(id, request?.id ?? "", "allow-session");
    await until(() => agents.snapshot(id).turns[0]?.status === "completed");
    const permission = (await logged()).find((l) => l.permission)?.permission as {
      updatedPermissions: {
        destination: string;
        rules: { toolName: string; ruleContent?: string }[];
      }[];
    };
    expect(permission.updatedPermissions.map((p) => p.destination)).toEqual(["session", "session"]);
    expect(permission.updatedPermissions[0]?.rules).toEqual([
      { toolName: "Write", ruleContent: "a.txt" },
    ]);
    const change = agents.snapshot(id).turns[0]?.items.find((i) => i.kind === "file-change");
    expect(change).toMatchObject({ status: "completed", changes: [{ change: "add" }] });
    await agents.closeAll();
  });

  test("always allow saves the rules where Claude proposed them", async () => {
    const agents = manager();
    const { id } = await agents.start({ provider: "claude-code" });
    await agents.prompt(id, { text: "write" });
    await until(() => agents.snapshot(id).approvals.length === 1);
    await agents.answer(id, agents.snapshot(id).approvals[0]?.id ?? "", "allow-always");
    await until(() => agents.snapshot(id).turns[0]?.status === "completed");
    const permission = (await logged()).find((l) => l.permission)?.permission as {
      behavior: string;
      updatedPermissions: { destination: string }[];
    };
    expect(permission.behavior).toBe("allow");
    expect(permission.updatedPermissions.map((p) => p.destination)).toEqual([
      "localSettings",
      "session",
    ]);
    await agents.closeAll();
  });

  test("a prompt Claude withdraws leaves the queue, and a hook callback is refused", async () => {
    const agents = manager();
    const { id } = await agents.start({ provider: "claude-code" });
    await agents.prompt(id, { text: "withdrawn" });
    await until(() => agents.snapshot(id).turns[0]?.status === "completed");
    expect(agents.snapshot(id).approvals).toEqual([]);
    expect((await logged()).find((l) => l.controlError)?.controlError).toMatchObject({
      subtype: "error",
      request_id: "hook-1",
    });
    await agents.closeAll();
  });

  test("deny and stop ends the turn as interrupted", async () => {
    const agents = manager();
    const { id } = await agents.start({ provider: "claude-code" });
    await agents.prompt(id, { text: "write" });
    await until(() => agents.snapshot(id).approvals.length === 1);
    await agents.answer(id, agents.snapshot(id).approvals[0]?.id ?? "", "abort");
    await until(() => agents.snapshot(id).turns[0]?.status === "interrupted");
    expect((await logged()).find((l) => l.permission)?.permission).toMatchObject({
      interrupt: true,
    });
    await agents.closeAll();
  });

  test("interrupt stops a running turn", async () => {
    const agents = manager();
    const { id } = await agents.start({ provider: "claude-code" });
    await agents.prompt(id, { text: "long" });
    await until(() => (agents.snapshot(id).turns[0]?.items.length ?? 0) > 1);
    await agents.interrupt(id);
    await until(() => agents.snapshot(id).turns[0]?.status === "interrupted");
    expect(agents.snapshot(id).session.state).toBe("idle");
    await agents.closeAll();
  });

  test("a follow-up while a turn runs is queued, then sent", async () => {
    const agents = manager();
    const { id } = await agents.start({ provider: "claude-code" });
    await agents.prompt(id, { text: "long" });
    expect((await agents.prompt(id, { text: "hello" })).mode).toBe("queued");
    await agents.interrupt(id);
    await until(() => agents.snapshot(id).turns[1]?.status === "completed");
    await agents.closeAll();
  });

  test("a malformed line is skipped with a warning", async () => {
    const agents = manager();
    const { id } = await agents.start({ provider: "claude-code" });
    await agents.prompt(id, { text: "garbage" });
    await until(() => agents.snapshot(id).turns[0]?.status === "completed");
    expect(agents.snapshot(id).turns[0]?.items.find((i) => i.kind === "notice")).toMatchObject({
      level: "warning",
    });
    await agents.closeAll();
  });

  test("a Velloo MCP server that didn't connect is said out loud", async () => {
    process.env.FAKE_CLAUDE_MODE = "mcp-failed";
    const agents = manager();
    const { id } = await agents.start({ provider: "claude-code" });
    await agents.prompt(id, { text: "hello" });
    await until(() => agents.snapshot(id).turns[0]?.status === "completed");
    const notice = agents.snapshot(id).turns[0]?.items.find((i) => i.kind === "notice");
    expect(notice).toMatchObject({ level: "error" });
    await agents.closeAll();
  });

  test("an expired sign-in fails the turn and says how to sign in again", async () => {
    const agents = manager();
    const { id } = await agents.start({ provider: "claude-code" });
    await agents.prompt(id, { text: "expired" });
    await until(() => agents.snapshot(id).turns[0]?.status === "failed");
    expect(agents.snapshot(id).turns[0]?.error).toContain("running `claude` in a terminal");
    expect(agents.snapshot(id).session.state).toBe("idle");
    await agents.closeAll();
  });

  test("a crash fails the session with Claude Code's last words", async () => {
    const agents = manager();
    const { id } = await agents.start({ provider: "claude-code" });
    await agents.prompt(id, { text: "crash" });
    await until(() => agents.snapshot(id).session.state === "failed");
    expect(agents.snapshot(id).session.stateMessage).toContain("the API is unreachable");
    expect(agents.snapshot(id).turns[0]?.status).toBe("failed");
  });

  test("reopening resumes the same Claude Code session", async () => {
    const agents = manager();
    const session = await agents.start({ provider: "claude-code" });
    await agents.terminate(session.id);
    await agents.reopen(session.id);
    const argvs = (await logged()).filter((l) => l.argv).map((l) => l.argv as string[]);
    expect(argvs[1]).toContain("--resume");
    expect(argvs[1]?.[argvs[1].indexOf("--resume") + 1]).toBe(session.providerSessionId ?? "");
    await agents.closeAll();
  });
});

describe("Claude Code's slash commands", () => {
  test("its commands and models are the session's controls; /model switches with set_model", async () => {
    const agents = manager();
    const { id } = await agents.start({ provider: "claude-code" });
    const controls = agents.snapshot(id).controls;
    expect(controls?.commands).toEqual([
      { name: "review", description: "Review the changes", argumentHint: "[pr]" },
      { name: "compact" },
    ]);
    expect(controls?.models).toEqual([
      { id: "default", label: "Default" },
      { id: "sonnet", label: "Sonnet", description: "Fast" },
    ]);
    expect(controls?.mcp?.actions).toEqual(["reconnect", "enable", "disable"]);
    // Known before anything is sent, from the settings Claude resolved…
    expect(controls?.model).toBe("sonnet");
    expect(agents.snapshot(id).session.environment?.model).toBe("claude-sonnet-test");
    // …and corrected by the model a turn reports.
    await agents.prompt(id, { text: "hello" });
    await until(() => agents.snapshot(id).controls?.model === "default");

    const session = await agents.setModel(id, "sonnet");
    expect(session.environment?.model).toBe("claude-sonnet-test");
    expect(agents.snapshot(id).controls?.model).toBe("sonnet");
    expect((await logged()).filter((l) => l.setModel)).toEqual([{ setModel: "sonnet" }]);
    await expect(agents.setModel(id, "gpt")).rejects.toThrow("can't switch to that model");
    await agents.closeAll();
    expect(agents.snapshot(id).controls).toBeUndefined();
  });

  test("/mcp lists its servers in a person's words, and reconnects or toggles one", async () => {
    const agents = manager();
    const { id } = await agents.start({ provider: "claude-code" });
    expect(await agents.mcpServers(id)).toEqual([
      {
        name: "velloo",
        status: "connected",
        detail: "Added for this session",
        tools: 2,
        velloo: true,
      },
      { name: "github", status: "failed", detail: "spawn ENOENT" },
      { name: "linear", status: "needs-auth", detail: "A plugin" },
      { name: "odd", status: "unknown" },
    ]);
    await agents.mcpAction(id, "github", "reconnect");
    await agents.mcpAction(id, "linear", "disable");
    await agents.mcpAction(id, "linear", "enable");
    expect((await logged()).filter((l) => l.mcp).map((l) => l.mcp)).toEqual([
      { subtype: "mcp_reconnect", serverName: "github" },
      { subtype: "mcp_toggle", serverName: "linear", enabled: false },
      { subtype: "mcp_toggle", serverName: "linear", enabled: true },
    ]);
    await expect(agents.mcpAction(id, "broken", "reconnect")).rejects.toThrow("No such server");
    await agents.closeAll();
  });

  test("its permission modes switch with set_permission_mode; bypassing every check isn't offered", async () => {
    const agents = manager();
    const { id } = await agents.start({ provider: "claude-code" });
    const controls = agents.snapshot(id).controls;
    expect(controls?.mode).toBe("default");
    expect(controls?.modes?.map((m) => m.id)).toEqual([
      "default",
      "acceptEdits",
      "plan",
      "auto",
      "dontAsk",
    ]);
    const session = await agents.setMode(id, "plan");
    expect(session.environment?.sandbox).toBe("plan");
    expect(agents.snapshot(id).controls?.mode).toBe("plan");
    expect((await logged()).filter((l) => l.setMode)).toEqual([{ setMode: "plan" }]);
    await expect(agents.setMode(id, "bypassPermissions")).rejects.toThrow("can't switch");
    // The mode Claude reports at the start of a turn is the one it runs.
    await agents.prompt(id, { text: "hello" });
    await until(() => agents.snapshot(id).controls?.mode === "default");
    await agents.closeAll();
  });
});

describe("Claude Code normalization", () => {
  test("MCP tool names split into server and tool", () => {
    expect(mcpTool("mcp__velloo__call_velloo")).toEqual({ server: "velloo", name: "call_velloo" });
    expect(mcpTool("Read")).toBeNull();
  });

  test("an Edit becomes a file change with a readable diff", () => {
    expect(
      toolUseItem("e", "Edit", { file_path: "/a.ts", old_string: "a", new_string: "b" }, "/"),
    ).toEqual({
      kind: "file-change",
      id: "e",
      status: "running",
      changes: [{ path: "/a.ts", change: "update", diff: "@@\n-a\n+b" }],
    });
  });

  test("TodoWrite becomes the plan", () => {
    expect(
      toolUseItem("t", "TodoWrite", { todos: [{ content: "Do it", status: "in_progress" }] }, "/"),
    ).toEqual({ kind: "plan", id: "t", steps: [{ text: "Do it", status: "in-progress" }] });
  });

  test("a tool call shows the one argument that says what it's about", () => {
    const cases: [string, Record<string, unknown>, string][] = [
      ["Read", { file_path: "/a.ts" }, "/a.ts"],
      ["Grep", { pattern: "TODO", path: "src" }, "TODO in src"],
      ["WebFetch", { url: "https://x.dev" }, "https://x.dev"],
      ["WebSearch", { query: "acp" }, "acp"],
    ];
    for (const [name, input, shown] of cases) {
      expect(toolUseItem("t", name, input, "/")).toMatchObject({
        kind: "tool",
        name,
        input: shown,
      });
    }
    expect(toolUseItem("s", "Task", { description: "Check the tests" }, "/")).toEqual({
      kind: "subagent",
      id: "s",
      description: "Check the tests",
      status: "running",
    });
    expect(toolUseItem("w", "Write", { file_path: "/n.ts", content: "a\nb" }, "/")).toMatchObject({
      changes: [{ path: "/n.ts", diff: "+a\n+b" }],
    });
    expect(
      toolUseItem(
        "m",
        "MultiEdit",
        {
          file_path: "/m.ts",
          edits: [
            { old_string: "a", new_string: "b" },
            { old_string: "c", new_string: "d" },
          ],
        },
        "/",
      ),
    ).toMatchObject({
      changes: [{ diff: "@@\n-a\n+b\n@@\n-c\n+d" }],
    });
  });

  test("questions, plans and MCP tools ask in their own terms", () => {
    expect(
      approvalFor(
        { tool_name: "AskUserQuestion", input: { questions: [{ question: "Which colour?" }] } },
        "/",
        { session: true, always: "Don't ask again." },
      ),
    ).toMatchObject({
      kind: "question",
      title: "Which colour?",
      questions: [{ id: "Which colour?", question: "Which colour?", options: [], other: true }],
      decisions: ["allow-once", "deny"],
    });
    expect(
      approvalFor({ tool_name: "AskUserQuestion", input: {} }, "/", { session: false }),
    ).toMatchObject({ kind: "question", decisions: ["deny"] });
    expect(
      approvalFor({ tool_name: "ExitPlanMode", input: { plan: "1. Do it" } }, "/", {
        session: false,
      }),
    ).toMatchObject({
      kind: "tool",
      title: "Approve the plan and start",
      input: "1. Do it",
    });
    expect(
      approvalFor({ tool_name: "mcp__velloo__call_velloo", input: { operation: "compose" } }, "/", {
        session: false,
      }),
    ).toMatchObject({
      kind: "tool",
      title: "Use velloo · call_velloo",
    });
    expect(
      approvalFor({ tool_name: "WebFetch", display_name: "Fetch", input: {} }, "/", {
        session: false,
      }).title,
    ).toBe("Use Fetch");
    expect(
      approvalFor(
        {
          tool_name: "Edit",
          input: { file_path: "/a.ts" },
          decision_reason: "Outside the project",
        },
        "/",
        { session: false },
      ),
    ).toMatchObject({
      kind: "file-change",
      title: "Edit a file",
      paths: ["/a.ts"],
      reason: "Outside the project",
    });
  });

  test("an MCP tool's rule is named as Claude Code's prompt names it", () => {
    expect(
      permissionChoices([
        {
          type: "addRules",
          rules: [{ toolName: "mcp__velloo__read_velloo" }],
          behavior: "allow",
          destination: "localSettings",
        },
      ]),
    ).toMatchObject({
      session: [{ destination: "session" }],
      saved: [{ destination: "localSettings" }],
      always:
        "Don't ask again for velloo · read_velloo in this project, for you only (.claude/settings.local.json).",
    });
    expect(permissionChoices([])).toEqual({ session: [], saved: [] });
  });

  test("an approval without a session rule doesn't offer one", () => {
    const request = approvalFor({ tool_name: "Bash", input: { command: "ls" } }, "/app", {
      session: false,
    });
    expect(request.decisions).toEqual(["allow-once", "deny", "abort"]);
    expect(request).toMatchObject({ kind: "command", command: "ls", cwd: "/app" });
  });
});
