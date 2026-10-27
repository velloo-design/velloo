import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentSessionSnapshot, AgentSessionSummary } from "@velloo/protocol/agent";
import type { CommentThread } from "@velloo/schema";
import { AcpAdapter } from "../agent/acp/adapter.ts";
import { ClaudeCodeAdapter } from "../agent/claude/adapter.ts";
import { CodexAdapter } from "../agent/codex/adapter.ts";
import { createServer, type ServerHandle } from "../index.ts";
import {
  designBoard,
  type ScaffoldedFolder,
  scaffoldDesignFolder,
} from "../testing/design-folder.ts";

/**
 * The Agent tab end to end, as the canvas drives it: a real daemon, its HTTP
 * API and socket, its MCP endpoint, and real adapters running scripted
 * stand-ins for `codex` and `claude` as child processes. What the stand-ins
 * can't show — a live model — was checked by hand against Codex 0.159 and
 * Claude Code 2.1.300 (see docs/agent-tab.md, "Release checklist").
 */

const FAKE_CODEX = join(import.meta.dir, "fixtures", "fake-codex.ts");
const FAKE_CLAUDE = join(import.meta.dir, "fixtures", "fake-claude.ts");
const FAKE_ACP = join(import.meta.dir, "fixtures", "fake-acp.ts");
const FOLDER_ID = "folder-agent-e2e";

let home: string;
let folder: ScaffoldedFolder;
let server: ServerHandle;
let socket: WebSocket;
let frames: { type: string; [key: string]: unknown }[];
let cloud: ReturnType<typeof Bun.serve>;
let cloudThreads: CommentThread[];

const adapters = () => [
  new CodexAdapter({ command: [process.execPath, FAKE_CODEX] }),
  new ClaudeCodeAdapter({ command: [process.execPath, FAKE_CLAUDE] }),
  new AcpAdapter(
    {
      id: "fake-acp",
      label: "Fake ACP",
      executable: "fake-acp",
      args: [],
      install: "",
      signIn: "",
    },
    { command: [process.execPath, FAKE_ACP] },
  ),
  // An ACP agent that isn't installed is never offered.
  new AcpAdapter({
    id: "absent-acp",
    label: "Absent",
    executable: "velloo-no-such-agent",
    args: [],
    install: "",
    signIn: "",
  }),
];

async function boot(): Promise<void> {
  server = await createServer({
    folder: folder.root,
    port: 0,
    mcp: { transport: "http", port: 0 },
    agentAdapters: adapters(),
    cloud: { url: `http://127.0.0.1:${cloud.port}`, token: "vlk_test" },
  });
  frames = [];
  await connect();
}

async function connect(): Promise<void> {
  socket = new WebSocket(`${server.url.replace("http", "ws")}/ws`);
  socket.onmessage = (e) => frames.push(JSON.parse(String(e.data)));
  await new Promise((resolve) => {
    socket.onopen = resolve;
  });
}

async function api<T = Record<string, unknown>>(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: T }> {
  const res = await fetch(`${server.url}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, body: (await res.json()) as T };
}

const snapshot = async (id: string) =>
  (await api<AgentSessionSnapshot>("GET", `/api/agent/sessions/${id}`)).body;

async function until<T>(
  check: () => Promise<T | undefined> | T | undefined,
  ms = 8_000,
): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value !== undefined && value !== false) return value;
    if (Date.now() > end) throw new Error("timed out waiting");
    await Bun.sleep(25);
  }
}

async function start(provider: string): Promise<AgentSessionSummary> {
  const res = await api<{ session: AgentSessionSummary }>("POST", "/api/agent/sessions", {
    provider,
  });
  expect(res.status).toBe(200);
  return res.body.session;
}

async function lastTurn(id: string, status: string) {
  return until(async () => {
    const turn = (await snapshot(id)).turns.at(-1);
    return turn?.status === status ? turn : undefined;
  });
}

const logged = async (file: string) =>
  (await readFile(join(home, file), "utf8").catch(() => ""))
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>);

beforeAll(() => {
  cloudThreads = [];
  cloud = Bun.serve({
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/v1/comment-threads") {
        return Response.json({ threads: cloudThreads, links: {}, now: new Date().toISOString() });
      }
      return new Response("not found", { status: 404 });
    },
  });
});
afterAll(() => cloud.stop(true));

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "velloo-agent-e2e-"));
  process.env.VELLOO_AGENTS_DIR = join(home, "agents");
  process.env.VELLOO_COMMENTS_DIR = join(home, "comments");
  process.env.FAKE_CODEX_LOG = join(home, "codex.log");
  process.env.FAKE_CLAUDE_LOG = join(home, "claude.log");
  process.env.FAKE_ACP_LOG = join(home, "acp.log");
  delete process.env.FAKE_CODEX_MODE;
  delete process.env.FAKE_CLAUDE_MODE;
  cloudThreads = [];
  folder = await scaffoldDesignFolder({
    label: "agent-e2e",
    nested: true,
    config: { folderId: FOLDER_ID },
    screens: { home: true },
    boards: { main: designBoard("main", ["home"]) },
  });
  await boot();
});
afterEach(async () => {
  socket?.close();
  await server?.close();
  await folder?.cleanup();
  await rm(home, { recursive: true, force: true });
});

describe("Codex in the Agent tab, end to end", () => {
  test("a prompt streams over the socket and its Velloo edit lands on the open design", async () => {
    const session = await start("codex");
    expect(session.environment?.cwd).toBeTruthy();
    const prompt = await api("POST", `/api/agent/sessions/${session.id}/turns`, {
      text: "note:main:Hello from the agent",
    });
    expect(prompt.body).toMatchObject({ mode: "started" });
    const turn = await lastTurn(session.id, "completed");
    const tool = turn.items.find((i) => i.kind === "tool");
    expect(tool).toMatchObject({ server: "velloo", name: "call_velloo", status: "completed" });

    const notes = JSON.parse(
      await readFile(join(folder.root, "boards", "main.notes.json"), "utf8"),
    ) as {
      body: string;
    }[];
    expect(notes.map((n) => n.body)).toContain("Hello from the agent");
    expect(frames.some((f) => f.type === "notes-changed")).toBe(true);
    expect(
      frames.some((f) => f.type === "activity" && f.verb === "add_note" && f.source === "mcp"),
    ).toBe(true);
    expect(frames.filter((f) => f.type === "agent" && f.event === "delta").length).toBeGreaterThan(
      0,
    );
  });

  test("approvals are allowed and denied by the person, never by Velloo", async () => {
    const session = await start("codex");
    for (const decision of ["allow-once", "deny"] as const) {
      await api("POST", `/api/agent/sessions/${session.id}/turns`, { text: "please approve this" });
      const request = await until(async () => (await snapshot(session.id)).approvals[0]);
      expect(request.command).toBe("rm -rf build");
      await api("POST", `/api/agent/sessions/${session.id}/approvals/${request.id}`, { decision });
      const turn = await lastTurn(session.id, "completed");
      expect(turn.items.find((i) => i.kind === "command")).toMatchObject({
        status: decision === "deny" ? "declined" : "completed",
      });
      await until(async () => (await snapshot(session.id)).session.state === "idle");
    }
  });

  test("a running turn can be interrupted", async () => {
    const session = await start("codex");
    await api("POST", `/api/agent/sessions/${session.id}/turns`, { text: "please approve this" });
    await until(async () => (await snapshot(session.id)).approvals[0]);
    expect((await api("POST", `/api/agent/sessions/${session.id}/interrupt`)).status).toBe(200);
    await lastTurn(session.id, "interrupted");
    expect((await snapshot(session.id)).approvals).toEqual([]);
  });

  test("a crash is reported with the provider's own words", async () => {
    process.env.FAKE_CODEX_MODE = "crash-on-turn";
    const session = await start("codex");
    await api("POST", `/api/agent/sessions/${session.id}/turns`, { text: "hello" });
    const failed = await until(async () => {
      const snap = await snapshot(session.id);
      return snap.session.state === "failed" ? snap : undefined;
    });
    expect(failed.session.stateMessage).toContain("the model is unavailable");
    expect(server.connections().agents).toBe(0);
  });

  test("a dropped socket loses nothing: the snapshot after reconnecting is whole", async () => {
    const session = await start("codex");
    socket.close();
    await api("POST", `/api/agent/sessions/${session.id}/turns`, { text: "hello while away" });
    await lastTurn(session.id, "completed");
    await connect();
    const snap = await snapshot(session.id);
    expect(snap.turns[0]?.items.map((i) => i.kind)).toEqual(["user", "agent-text"]);
    expect(snap.turns[0]?.items[0]).toMatchObject({ text: "hello while away" });
  });

  test("a daemon restart keeps the session, and reopening resumes the same thread", async () => {
    const session = await start("codex");
    await api("POST", `/api/agent/sessions/${session.id}/turns`, { text: "before the restart" });
    await lastTurn(session.id, "completed");
    expect(server.connections().agents).toBe(1);
    socket.close();
    await server.close();

    await boot();
    const listed = (await api<{ sessions: AgentSessionSummary[] }>("GET", "/api/agent/sessions"))
      .body.sessions;
    expect(listed[0]).toMatchObject({ id: session.id, state: "exited", resumable: true });
    expect((await snapshot(session.id)).turns[0]?.items[0]).toMatchObject({
      text: "before the restart",
    });
    const reopened = await api<{ session: AgentSessionSummary }>(
      "POST",
      `/api/agent/sessions/${session.id}/reopen`,
    );
    expect(reopened.body.session.state).toBe("idle");
    const resume = (await logged("codex.log")).find((l) => l.method === "thread/resume");
    expect((resume?.params as { threadId?: string })?.threadId).toBe("t1");
  });
});

describe("Claude Code in the Agent tab, end to end", () => {
  test("tools stream and settle; a denied permission is declined, an allowed one runs", async () => {
    const session = await start("claude-code");
    await api("POST", `/api/agent/sessions/${session.id}/turns`, { text: "bash" });
    const turn = await lastTurn(session.id, "completed");
    expect(turn.items.find((i) => i.kind === "command")).toMatchObject({
      output: "hi",
      status: "completed",
    });
    expect(turn.items.find((i) => i.kind === "tool")).toMatchObject({
      server: "velloo",
      name: "compose",
    });

    for (const [decision, status] of [
      ["deny", "declined"],
      ["allow-once", "completed"],
    ] as const) {
      await api("POST", `/api/agent/sessions/${session.id}/turns`, { text: "write" });
      const request = await until(async () => (await snapshot(session.id)).approvals[0]);
      await api("POST", `/api/agent/sessions/${session.id}/approvals/${request.id}`, { decision });
      await until(async () => {
        const last = (await snapshot(session.id)).turns.at(-1);
        return last?.status === "completed" ? last : undefined;
      });
      const last = (await snapshot(session.id)).turns.at(-1);
      expect(last?.items.find((i) => i.kind === "file-change")).toMatchObject({ status });
    }
  });

  test("interrupt, crash and resume", async () => {
    const session = await start("claude-code");
    await api("POST", `/api/agent/sessions/${session.id}/turns`, { text: "long" });
    await until(async () => ((await snapshot(session.id)).turns[0]?.items.length ?? 0) > 1);
    await api("POST", `/api/agent/sessions/${session.id}/interrupt`);
    await lastTurn(session.id, "interrupted");

    await api("POST", `/api/agent/sessions/${session.id}/turns`, { text: "crash" });
    await until(async () => (await snapshot(session.id)).session.state === "failed");
    const reopened = await api<{ session: AgentSessionSummary }>(
      "POST",
      `/api/agent/sessions/${session.id}/reopen`,
    );
    expect(reopened.body.session.state).toBe("idle");
    const argvs = (await logged("claude.log")).filter((l) => l.argv).map((l) => l.argv as string[]);
    expect(argvs.at(-1)).toContain("--resume");
  });
});

describe("an Agent Client Protocol agent in the Agent tab, end to end", () => {
  test("is offered beside Codex and Claude Code; one that isn't installed is not", async () => {
    const providers = (
      await api<{ providers: { id: string; status: string }[] }>("GET", "/api/agent/providers")
    ).body.providers;
    expect(providers.map((p) => p.id)).toEqual(["codex", "claude-code", "fake-acp"]);
  });

  test("a prompt streams, a permission is answered, and the daemon's MCP server is handed over", async () => {
    const session = await start("fake-acp");
    await api("POST", `/api/agent/sessions/${session.id}/turns`, { text: "edit" });
    const request = await until(async () => (await snapshot(session.id)).approvals[0]);
    await api("POST", `/api/agent/sessions/${session.id}/approvals/${request.id}`, {
      decision: "allow-once",
    });
    const turn = await lastTurn(session.id, "completed");
    expect(turn.items.find((i) => i.kind === "file-change")).toMatchObject({ status: "completed" });
    expect(turn.items.find((i) => i.kind === "agent-text")).toMatchObject({ text: "Hello there" });
    const created = (await logged("acp.log")).find((l) => l.method === "session/new");
    const servers =
      (created?.params as { mcpServers?: { type: string; url: string }[] } | undefined)
        ?.mcpServers ?? [];
    expect(servers[0]?.type).toBe("http");
    expect(servers[0]?.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp/);
  });
});

describe("comments to the agent, end to end", () => {
  test("a local comment sent as a card alone reaches the agent with its thread", async () => {
    const created = await api<{ thread: CommentThread }>("POST", "/api/comments", {
      boardId: "main",
      body: "The CTA is cramped on mobile",
    });
    const thread = created.body.thread;
    const session = await start("codex");
    await api("POST", `/api/agent/sessions/${session.id}/turns`, {
      text: "",
      context: [
        {
          kind: "comment",
          ref: { boardId: "main", threadId: thread.id, messageId: thread.messages[0]?.id },
          label: "main",
          detail: "The CTA is cramped on mobile",
        },
      ],
    });
    await lastTurn(session.id, "completed");
    const sent = (await logged("codex.log")).find((l) => l.method === "turn/start");
    const params = sent?.params as { input?: { text: string }[] } | undefined;
    const text = params?.input?.[0]?.text ?? "";
    expect(text).toContain("Address these comments on the design.");
    expect(text).toContain(`Comment thread ${thread.id} (local)`);
    expect(text).toContain('"The CTA is cramped on mobile"');
    const user = (await snapshot(session.id)).turns[0]?.items[0];
    expect(user).toMatchObject({ kind: "user", text: "", context: [{ kind: "comment" }] });
  });

  test("a pulled cloud comment is announced on the socket, then reaches the agent once sent", async () => {
    // The first pull on a machine is the baseline; nothing in it is new.
    await api("GET", "/api/comments?boardId=main&status=all");
    const now = new Date().toISOString();
    cloudThreads.push({
      id: "11111111-1111-4111-8111-111111111111",
      scope: "shared",
      folderId: FOLDER_ID,
      boardId: "main",
      origin: { kind: "published", slug: "review", versionId: "v1" },
      status: "open",
      messages: [
        {
          id: "22222222-2222-4222-8222-222222222222",
          author: { kind: "reviewer", displayName: "Jon" },
          body: "Plan names in sentence case",
          createdAt: now,
        },
      ],
      createdAt: now,
      updatedAt: now,
    });
    await api("GET", "/api/comments?boardId=main&status=all");
    const arrived = await until(() => frames.find((f) => f.type === "comments-arrived"));
    expect(arrived).toMatchObject({
      boardId: "main",
      threadIds: ["11111111-1111-4111-8111-111111111111"],
      messageIds: ["22222222-2222-4222-8222-222222222222"],
    });
    expect(
      (await api<{ arrivals: unknown[] }>("GET", "/api/comments/arrivals")).body.arrivals,
    ).toHaveLength(1);

    // Nothing reached an agent; the person adds it to the composer and sends.
    const session = await start("claude-code");
    expect((await logged("claude.log")).some((l) => l.permission)).toBe(false);
    await api("POST", "/api/comments/arrivals/ack", {
      messageIds: ["22222222-2222-4222-8222-222222222222"],
    });
    await api("POST", `/api/agent/sessions/${session.id}/turns`, {
      text: "hello",
      context: [
        {
          kind: "comment",
          ref: {
            boardId: "main",
            threadId: "11111111-1111-4111-8111-111111111111",
            messageId: "22222222-2222-4222-8222-222222222222",
          },
          label: "main",
          author: "Jon",
        },
      ],
    });
    await lastTurn(session.id, "completed");
    expect(
      (await api<{ arrivals: unknown[] }>("GET", "/api/comments/arrivals")).body.arrivals,
    ).toEqual([]);
    const user = (await snapshot(session.id)).turns[0]?.items[0];
    expect(user).toMatchObject({ kind: "user", context: [{ kind: "comment", author: "Jon" }] });
  });
});

describe("what a page can't do to a local agent", () => {
  function raw(path: string, headers: Record<string, string>, body: unknown): Promise<number> {
    return new Promise((resolve, reject) => {
      const req = httpRequest(
        {
          host: "127.0.0.1",
          port: server.port,
          path,
          method: "POST",
          headers: { "content-type": "application/json", ...headers },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on("error", reject);
      req.end(JSON.stringify(body));
    });
  }

  test("a cross-origin page and a DNS-rebound host are refused", async () => {
    expect(
      await raw(
        "/api/agent/sessions",
        { host: `127.0.0.1:${server.port}`, origin: "https://attacker.example" },
        { provider: "codex" },
      ),
    ).toBe(403);
    expect(
      await raw(
        "/api/agent/sessions",
        { host: `attacker.example:${server.port}` },
        { provider: "codex" },
      ),
    ).toBe(403);
    expect(
      (await api<{ sessions: unknown[] }>("GET", "/api/agent/sessions")).body.sessions,
    ).toEqual([]);
  });

  test("a start can't name a directory, executable, environment, sandbox or permission mode", async () => {
    for (const extra of [
      { cwd: "/" },
      { executable: "/bin/sh" },
      { command: ["sh"] },
      { env: { OPENAI_API_KEY: "x" } },
      { sandbox: "danger-full-access" },
      { approvalPolicy: "never" },
      { permissionMode: "bypassPermissions" },
    ]) {
      expect(
        (await api("POST", "/api/agent/sessions", { provider: "codex", ...extra })).status,
      ).toBe(400);
    }
    expect(await logged("codex.log")).toEqual([]);
  });

  test("Codex runs on stdio only, and Claude Code with the person's own permissions", async () => {
    await start("codex");
    await start("claude-code");
    const codexArgv = (await logged("codex.log")).find((l) => l.argv)?.argv as string[];
    expect(codexArgv).toEqual(["app-server"]);
    const claudeArgv = (await logged("claude.log")).find((l) => l.argv)?.argv as string[];
    for (const flag of [
      "--permission-mode",
      "--dangerously-skip-permissions",
      "--allow-dangerously-skip-permissions",
      "--remote-control",
    ]) {
      expect(claudeArgv).not.toContain(flag);
    }
  });
});
