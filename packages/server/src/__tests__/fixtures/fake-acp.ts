/**
 * A stand-in Agent Client Protocol agent for the adapter tests: JSON-RPC 2.0
 * over stdio, scripted by the prompt. `FAKE_ACP_MODE` picks a failure
 * (`v2` speaks protocol 2, `auth` refuses to start a session, `garbage`
 * prints a non-JSON line); `FAKE_ACP_LOG` records every request it gets.
 */
import { appendFileSync } from "node:fs";

const mode = process.env.FAKE_ACP_MODE ?? "";
const log = (value: unknown) => {
  if (process.env.FAKE_ACP_LOG)
    appendFileSync(process.env.FAKE_ACP_LOG, `${JSON.stringify(value)}\n`);
};
const send = (value: unknown): undefined => {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...(value as object) })}\n`);
};
const update = (sessionId: string, u: unknown) =>
  send({ method: "session/update", params: { sessionId, update: u } });
const waiting = new Map<number, (result: unknown) => void>();
let nextId = 500;
let cancel: (() => void) | null = null;

function ask(params: unknown): Promise<{ outcome: { outcome: string; optionId?: string } }> {
  const id = nextId++;
  const answer = new Promise<{ outcome: { outcome: string; optionId?: string } }>((resolve) =>
    waiting.set(id, resolve as (r: unknown) => void),
  );
  send({ id, method: "session/request_permission", params });
  return answer;
}

async function prompt(id: number, sessionId: string, text: string) {
  if (text.includes("crash")) {
    process.stderr.write("fatal: the agent fell over\n");
    process.exit(1);
  }
  if (text.includes("garbage")) process.stdout.write("this is not json\n");
  if (text.includes("silent")) return send({ id, result: { stopReason: "end_turn" } });
  if (text.includes("model elsewhere")) {
    update(sessionId, { sessionUpdate: "current_model_update", currentModelId: "m1" });
    update(sessionId, {
      sessionUpdate: "available_commands_update",
      availableCommands: [{ name: "only", description: "The one left" }],
    });
  }
  if (text.includes("long")) {
    update(sessionId, {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "Once upon" },
    });
    await new Promise<void>((resolve) => {
      cancel = resolve;
    });
    return send({ id, result: { stopReason: "cancelled" } });
  }
  if (text.includes("run")) {
    update(sessionId, {
      sessionUpdate: "tool_call",
      toolCallId: "t1",
      title: "ls",
      kind: "execute",
      status: "in_progress",
      rawInput: { command: ["ls", "-la"] },
    });
    update(sessionId, {
      sessionUpdate: "tool_call_update",
      toolCallId: "t1",
      status: "completed",
      content: [{ type: "content", content: { type: "text", text: "README.md" } }],
    });
    update(sessionId, {
      sessionUpdate: "tool_call",
      toolCallId: "t2",
      title: "velloo_compose",
      kind: "other",
      status: "completed",
      rawInput: { screenId: "home" },
    });
    update(sessionId, {
      sessionUpdate: "plan",
      entries: [{ content: "Look", priority: "high", status: "completed" }],
    });
  }
  if (text.includes("edit")) {
    update(sessionId, {
      sessionUpdate: "tool_call",
      toolCallId: "e1",
      title: "Edit a.ts",
      kind: "edit",
      status: "pending",
      content: [{ type: "diff", path: "/app/a.ts", oldText: "a", newText: "b" }],
    });
    const answer = await ask({
      sessionId,
      toolCall: { toolCallId: "e1", title: "Edit a.ts", kind: "edit" },
      options: [
        { optionId: "yes", name: "Allow", kind: "allow_once" },
        { optionId: "always", name: "Always", kind: "allow_always" },
        { optionId: "no", name: "Reject", kind: "reject_once" },
      ],
    });
    log({ permission: answer });
    const allowed = answer.outcome.outcome === "selected" && answer.outcome.optionId === "yes";
    update(sessionId, {
      sessionUpdate: "tool_call_update",
      toolCallId: "e1",
      status: allowed ? "completed" : "failed",
    });
  }
  update(sessionId, {
    sessionUpdate: "agent_thought_chunk",
    content: { type: "text", text: "Thinking" },
  });
  update(sessionId, {
    sessionUpdate: "agent_message_chunk",
    content: { type: "text", text: "Hello" },
  });
  update(sessionId, {
    sessionUpdate: "agent_message_chunk",
    content: { type: "text", text: " there" },
  });
  return send({ id, result: { stopReason: text.includes("refuse") ? "refusal" : "end_turn" } });
}

/** The two (unstable) ways an ACP agent offers models, picked by `FAKE_ACP_MODE`. */
const MODELS: Record<string, (current: string) => Record<string, unknown>> = {
  "": (current) => ({
    models: {
      availableModels: [
        { modelId: "m1", name: "Model One" },
        { modelId: "m2", name: "Model Two", description: "Bigger" },
        { name: "no id" },
      ],
      currentModelId: current,
    },
  }),
  config: (current) => ({
    configOptions: [
      { id: "mode", category: "mode", type: "select", currentValue: "ask", options: [] },
      {
        id: "model",
        name: "Model",
        category: "model",
        type: "select",
        currentValue: current === "m1" ? "c1" : current,
        options: [
          { group: "local", name: "Local", options: [{ value: "c1", name: "C One" }] },
          { value: "c2", name: "C Two", description: "Hosted" },
          { name: "no value" },
        ],
      },
    ],
  }),
};

function handle(m: {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
}): void {
  if (m.method) log({ method: m.method, params: m.params });
  if (m.id !== undefined && !m.method) {
    waiting.get(m.id)?.(m.result);
    waiting.delete(m.id);
    return;
  }
  switch (m.method) {
    case "initialize":
      send({
        id: m.id,
        result: {
          protocolVersion: mode === "v2" ? 2 : 1,
          agentCapabilities: { loadSession: true, mcpCapabilities: { http: mode !== "stdio-mcp" } },
          authMethods: [],
          agentInfo: { name: "Fake", version: "3.2.1" },
        },
      });
      return;
    case "session/new":
      if (mode === "auth") {
        send({ id: m.id, error: { code: -32000, message: "Authentication required" } });
        return;
      }
      // One write, as a real agent's can arrive: the commands in the same
      // read as the answer that names the session.
      process.stdout.write(
        [
          { jsonrpc: "2.0", id: m.id, result: { sessionId: "s-fake", ...MODELS[mode]?.("m1") } },
          {
            jsonrpc: "2.0",
            method: "session/update",
            params: {
              sessionId: "s-fake",
              update: {
                sessionUpdate: "available_commands_update",
                availableCommands: [
                  { name: "init", description: "Set the project up", input: { hint: "[dir]" } },
                  { name: "/review", description: "" },
                  { description: "a command without a name" },
                ],
              },
            },
          },
        ]
          .map((line) => `${JSON.stringify(line)}\n`)
          .join(""),
      );
      return;
    case "session/set_model":
      send({ id: m.id, result: {} });
      return;
    case "session/set_config_option":
      send({ id: m.id, result: MODELS.config?.(String(m.params?.value)) });
      return;
    case "session/load": {
      const sessionId = String(m.params?.sessionId);
      update(sessionId, {
        sessionUpdate: "user_message_chunk",
        content: { type: "text", text: "earlier " },
      });
      update(sessionId, {
        sessionUpdate: "user_message_chunk",
        content: { type: "text", text: "prompt" },
      });
      update(sessionId, {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "earlier answer" },
      });
      send({ id: m.id, result: { ...MODELS[mode]?.("m2") } });
      return;
    }
    case "session/prompt": {
      const blocks = (m.params?.prompt as { text?: string }[] | undefined) ?? [];
      void prompt(
        m.id ?? 0,
        String(m.params?.sessionId),
        blocks.map((b) => b.text ?? "").join("\n"),
      );
      return;
    }
    case "session/cancel":
      cancel?.();
      return;
    default:
      if (m.id !== undefined)
        send({ id: m.id, error: { code: -32601, message: "unknown method" } });
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
