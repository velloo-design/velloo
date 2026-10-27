/**
 * A stand-in `codex` for the adapter tests: answers `--version`, writes a
 * protocol schema, and runs a scripted app-server over stdio. `FAKE_CODEX_MODE`
 * picks a failure to act out; `FAKE_CODEX_LOG` records every request it gets.
 */
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const mode = process.env.FAKE_CODEX_MODE ?? "";
const log = process.env.FAKE_CODEX_LOG;

if (args[0] === "--version") {
  console.log("codex-cli 9.9.9");
  process.exit(0);
}

if (args[0] === "app-server" && args[1] === "generate-json-schema") {
  const out = args[args.indexOf("--out") + 1] ?? ".";
  mkdirSync(out, { recursive: true });
  const client = [
    "initialize",
    "account/read",
    "config/read",
    "thread/start",
    "thread/resume",
    "thread/list",
    "thread/name/set",
    "turn/start",
    "turn/steer",
    ...(mode === "old" ? [] : ["turn/interrupt"]),
    ...(mode === "old" || mode === "no-catalog" ? [] : ["model/list", "mcpServerStatus/list"]),
  ];
  const server = ["item/commandExecution/requestApproval", "item/fileChange/requestApproval"];
  const schema = (methods: string[]) => ({
    oneOf: methods.map((m) => ({ properties: { method: { enum: [m] } } })),
  });
  writeFileSync(join(out, "ClientRequest.json"), JSON.stringify(schema(client)));
  writeFileSync(join(out, "ServerRequest.json"), JSON.stringify(schema(server)));
  process.exit(0);
}

if (args[0] !== "app-server") process.exit(2);
if (log) appendFileSync(log, `${JSON.stringify({ argv: args })}\n`);

const send = (value: unknown): undefined => {
  process.stdout.write(`${JSON.stringify(value)}\n`);
};
const thread = (id: string, turns: unknown[] = []) => ({
  id,
  name: null,
  preview: "",
  ephemeral: false,
  turns,
});
let overloaded = false;
let serverRequestId = 1000;
const waiting = new Map<number, (result: unknown) => void>();
let turnCount = 0;
/** The velloo MCP endpoint the daemon handed this session, from thread/start's config. */
let mcpUrl: string | undefined;

/** One JSON-RPC exchange with an MCP server over streamable HTTP. */
async function mcpPost(
  body: unknown,
  session?: string,
): Promise<{ session: string | undefined; result: unknown }> {
  if (!mcpUrl) throw new Error("no MCP server was configured");
  const res = await fetch(mcpUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(session ? { "mcp-session-id": session } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  const data = text.trim().startsWith("{")
    ? text
    : (text
        .split("\n")
        .find((l) => l.startsWith("data:"))
        ?.slice(5) ?? "");
  const parsed = data ? (JSON.parse(data) as { result?: unknown }) : {};
  return { session: res.headers.get("mcp-session-id") ?? session, result: parsed.result };
}

/** Make a real design edit through the daemon's own MCP endpoint, as Codex would. */
async function addNoteThroughVelloo(boardId: string, body: string): Promise<string> {
  const init = await mcpPost({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "fake-codex", version: "0" },
    },
  });
  await mcpPost({ jsonrpc: "2.0", method: "notifications/initialized" }, init.session);
  const call = await mcpPost(
    {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "call_velloo",
        arguments: { operation: "add_note", arguments: { boardId, x: 0, y: 0, body } },
      },
    },
    init.session,
  );
  const content = (call.result as { content?: { text?: string }[] } | undefined)?.content ?? [];
  return content.map((c) => c.text ?? "").join("\n");
}

async function runTurn(turnId: string, text: string) {
  send({
    method: "turn/started",
    params: { threadId: "t1", turn: { id: turnId, status: "inProgress" } },
  });
  const msg = { type: "agentMessage", id: `m-${turnId}`, text: "", phase: "final_answer" };
  send({ method: "item/started", params: { threadId: "t1", turnId, item: msg } });
  send({
    method: "item/agentMessage/delta",
    params: { threadId: "t1", turnId, itemId: msg.id, delta: "Working" },
  });
  const note = text.match(/note:([\w-]+):(.+)/);
  if (note) {
    const call = {
      type: "mcpToolCall",
      id: `mcp-${turnId}`,
      server: "velloo",
      tool: "call_velloo",
      status: "inProgress",
      arguments: { operation: "add_note", arguments: { boardId: note[1] } },
      result: null,
      error: null,
    };
    send({ method: "item/started", params: { threadId: "t1", turnId, item: call } });
    const result = await addNoteThroughVelloo(note[1] ?? "", note[2] ?? "").catch(
      (e: Error) => `error: ${e.message}`,
    );
    send({
      method: "item/completed",
      params: {
        threadId: "t1",
        turnId,
        item: {
          ...call,
          status: "completed",
          result: { content: [{ type: "text", text: result }] },
        },
      },
    });
  }
  if (text.includes("notify")) {
    send({
      method: "thread/name/updated",
      params: { threadId: "t1", threadName: "Named by Codex" },
    });
    send({ method: "warning", params: { threadId: "t1", message: "Slow network" } });
    send({
      method: "error",
      params: { threadId: "t1", turnId, willRetry: true, error: { message: "Rate limited" } },
    });
    send({
      method: "mcpServer/startupStatus/updated",
      params: { threadId: "t1", name: "velloo", status: "failed", error: "spawn ENOENT" },
    });
    send({
      method: "thread/status/changed",
      params: { threadId: "t1", status: { type: "systemError" } },
    });
    send({
      method: "turn/plan/updated",
      params: { threadId: "t1", turnId, plan: [{ step: "Look", status: "inProgress" }] },
    });
    send({
      method: "turn/diff/updated",
      params: { threadId: "t1", turnId, diff: "diff --git a/x b/x" },
    });
    send({ method: "thread/started", params: { threadId: "someone-else" } });
  }
  if (text.includes("asks")) {
    for (const [method, params] of [
      [
        "item/permissions/requestApproval",
        {
          threadId: "t1",
          turnId,
          itemId: "p1",
          cwd: "/app",
          reason: "Needs network",
          permissions: { network: { enabled: true }, fileSystem: null },
        },
      ],
      [
        "item/tool/requestUserInput",
        {
          threadId: "t1",
          turnId,
          itemId: "q1",
          isBlocking: true,
          questions: [
            { id: "a", header: "Pick", question: "Which colour?" },
            { id: "b", header: "Size", question: "How big?" },
          ],
        },
      ],
      ["item/tool/call", { threadId: "t1", turnId, tool: "x" }],
    ] as const) {
      const id = serverRequestId++;
      const answer = new Promise((resolve) => waiting.set(id, resolve));
      send({ id, method, params });
      if (method === "item/tool/call") {
        if (log) appendFileSync(log, `${JSON.stringify({ toolCallAnswer: await answer })}\n`);
        continue;
      }
      const result = await answer;
      if (log) appendFileSync(log, `${JSON.stringify({ askAnswer: { method, result } })}\n`);
    }
  }
  if (text.includes("withdraw")) {
    const id = serverRequestId++;
    send({
      id,
      method: "item/fileChange/requestApproval",
      params: { threadId: "t1", turnId, itemId: "f1", grantRoot: "/elsewhere" },
    });
    await new Promise((r) => setTimeout(r, 50));
    send({ method: "serverRequest/resolved", params: { threadId: "t1", requestId: id } });
  }
  if (text.includes("elicit")) {
    const id = serverRequestId++;
    const answer = new Promise((resolve) => waiting.set(id, resolve));
    const requestedSchema = text.includes("form")
      ? { type: "object", properties: { name: { type: "string" } }, required: ["name"] }
      : { type: "object", properties: {} };
    send({
      id,
      method: "mcpServer/elicitation/request",
      params: {
        threadId: "t1",
        turnId,
        serverName: "computer-use",
        mode: "form",
        _meta: null,
        message: 'Allow Computer Use to use "Google Chrome"?',
        requestedSchema,
      },
    });
    if (log) appendFileSync(log, `${JSON.stringify({ elicitationAnswer: await answer })}\n`);
  }
  if (text.includes("approve")) {
    const cmd = {
      type: "commandExecution",
      id: `c-${turnId}`,
      command: "/bin/zsh -lc 'rm -rf build'",
      cwd: "/app",
      status: "inProgress",
      aggregatedOutput: null,
      exitCode: null,
    };
    send({ method: "item/started", params: { threadId: "t1", turnId, item: cmd } });
    const id = serverRequestId++;
    const answer = new Promise((resolve) => waiting.set(id, resolve));
    send({
      id,
      method: "item/commandExecution/requestApproval",
      params: {
        threadId: "t1",
        turnId,
        itemId: cmd.id,
        command: "/bin/zsh -lc 'rm -rf build'",
        cwd: "/app",
        reason: "Deletes files",
        proposedExecpolicyAmendment: ["rm", "-rf", "build"],
      },
    });
    const result = (await answer) as { decision?: unknown };
    if (log) appendFileSync(log, `${JSON.stringify({ commandAnswer: result })}\n`);
    const declined =
      result.decision !== "accept" &&
      result.decision !== "acceptForSession" &&
      typeof result.decision !== "object";
    send({
      method: "item/completed",
      params: {
        threadId: "t1",
        turnId,
        item: {
          ...cmd,
          status: declined ? "declined" : "completed",
          exitCode: declined ? null : 0,
          aggregatedOutput: declined ? null : "removed\n",
        },
      },
    });
  }
  send({
    method: "item/completed",
    params: { threadId: "t1", turnId, item: { ...msg, text: "Working" } },
  });
  send({
    method: "turn/completed",
    params: { threadId: "t1", turn: { id: turnId, status: "completed", error: null } },
  });
}

function handle(m: {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: unknown;
}) {
  if (log && m.method)
    appendFileSync(log, `${JSON.stringify({ method: m.method, params: m.params })}\n`);
  if (m.id !== undefined && !m.method) {
    waiting.get(m.id)?.(m.error === undefined ? m.result : { error: m.error });
    waiting.delete(m.id);
    return;
  }
  const reply = (result: unknown) => send({ id: m.id, result });
  switch (m.method) {
    case "initialize":
      return reply({
        userAgent: "fake",
        codexHome: "/tmp",
        platformFamily: "unix",
        platformOs: "macos",
      });
    case "initialized":
      return;
    case "account/read":
      return reply(
        mode === "logged-out"
          ? { account: null, requiresOpenaiAuth: true }
          : {
              account: { type: "chatgpt", email: "someone@example.com", planType: "pro" },
              requiresOpenaiAuth: true,
            },
      );
    case "config/read":
      return reply({ config: JSON.parse(process.env.FAKE_CODEX_CONFIG ?? "{}") });
    case "thread/start": {
      const config = (m.params?.config ?? {}) as Record<string, { url?: string }>;
      mcpUrl = config["mcp_servers.velloo"]?.url;
      return reply({
        thread: thread("t1"),
        model: "fake-model",
        cwd: m.params?.cwd,
        approvalPolicy: m.params?.approvalPolicy,
        sandbox: { type: "workspaceWrite" },
      });
    }
    case "thread/resume":
      return reply({
        thread: thread(String(m.params?.threadId), [
          {
            id: "old-turn",
            status: "completed",
            startedAt: 1_700_000_000,
            completedAt: 1_700_000_010,
            items: [
              {
                type: "userMessage",
                id: "u0",
                content: [{ type: "text", text: "earlier prompt" }],
              },
              { type: "agentMessage", id: "a0", text: "earlier answer", phase: "final_answer" },
            ],
          },
        ]),
        model: "fake-model",
        cwd: m.params?.cwd,
        approvalPolicy: m.params?.approvalPolicy,
        sandbox: { type: "workspaceWrite" },
      });
    case "thread/list":
      return reply({
        data: [
          { id: "t-old", name: "An earlier thread", preview: "hello", updatedAt: 1_700_000_000 },
        ],
        nextCursor: null,
      });
    case "turn/start": {
      if (mode === "crash-on-turn") {
        process.stderr.write("boom: the model is unavailable\n");
        process.exit(1);
      }
      if (mode === "overload-once" && !overloaded) {
        overloaded = true;
        return send({
          id: m.id,
          error: { code: -32001, message: "Server overloaded; retry later." },
        });
      }
      const turnId = `turn-${++turnCount}`;
      reply({ turn: { id: turnId, items: [], status: "inProgress" } });
      if (mode === "malformed") process.stdout.write("this is not json\n");
      const input = (m.params?.input as { text?: string }[] | undefined)?.[0]?.text ?? "";
      void runTurn(turnId, input);
      return;
    }
    case "model/list":
      if (mode === "no-models") return send({ id: m.id, error: { code: -32603, message: "no" } });
      return reply({
        data: [
          {
            id: "fake-model",
            model: "fake-model",
            displayName: "Fake",
            description: "",
            hidden: false,
          },
          {
            id: "fast",
            model: "fake-fast",
            displayName: "Fast",
            description: "Quick",
            hidden: false,
          },
          { id: "secret", model: "fake-secret", displayName: "Secret", hidden: true },
          { id: 7 },
        ],
        nextCursor: null,
      });
    case "mcpServerStatus/list":
      return reply(
        m.params?.cursor
          ? {
              data: [{ name: "figma", authStatus: "notLoggedIn", runtimeStatus: null, tools: {} }],
              nextCursor: null,
            }
          : {
              data: [
                {
                  name: "velloo",
                  authStatus: "unsupported",
                  runtimeStatus: "connected",
                  tools: { compose: {}, get_board: {} },
                },
                {
                  name: "backlog",
                  authStatus: "unsupported",
                  runtimeStatus: "failed",
                  tools: {},
                  toolsError: "exited with code 1",
                },
              ],
              nextCursor: "page-2",
            },
      );
    case "turn/interrupt":
      reply({});
      send({
        method: "turn/completed",
        params: {
          threadId: "t1",
          turn: { id: m.params?.turnId, status: "interrupted", error: null },
        },
      });
      return;
    default:
      if (m.id !== undefined)
        send({ id: m.id, error: { code: -32601, message: "unknown method" } });
      return;
  }
}

let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += chunk.toString();
  let newline = buffer.indexOf("\n");
  while (newline >= 0) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    newline = buffer.indexOf("\n");
    if (line) handle(JSON.parse(line));
  }
});
process.stdin.on("end", () => process.exit(0));
