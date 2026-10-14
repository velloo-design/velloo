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
      },
    });
    const result = (await answer) as { decision?: string };
    const declined = result.decision !== "accept" && result.decision !== "acceptForSession";
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
}) {
  if (log && m.method)
    appendFileSync(log, `${JSON.stringify({ method: m.method, params: m.params })}\n`);
  if (m.id !== undefined && !m.method) {
    waiting.get(m.id)?.(m.result);
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
    case "thread/start":
      return reply({
        thread: thread("t1"),
        model: "fake-model",
        cwd: m.params?.cwd,
        approvalPolicy: m.params?.approvalPolicy,
        sandbox: { type: "workspaceWrite" },
      });
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
