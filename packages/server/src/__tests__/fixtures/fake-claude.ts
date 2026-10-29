/**
 * A stand-in `claude` for the adapter tests: answers `--version`, `--help` and
 * `auth status`, and runs a scripted stream-json session. The prompt picks the
 * script; `FAKE_CLAUDE_MODE` picks a failure; `FAKE_CLAUDE_LOG` records the
 * argv and every control response Velloo sends.
 */
import { appendFileSync } from "node:fs";

const args = process.argv.slice(2);
const mode = process.env.FAKE_CLAUDE_MODE ?? "";
const log = (value: unknown) => {
  if (process.env.FAKE_CLAUDE_LOG)
    appendFileSync(process.env.FAKE_CLAUDE_LOG, `${JSON.stringify(value)}\n`);
};

if (args[0] === "--version") {
  console.log("2.1.300 (Claude Code)");
  process.exit(0);
}
if (args[0] === "--help") {
  const flags = [
    "--input-format",
    "--output-format",
    "--mcp-config",
    "--append-system-prompt",
    "--resume",
  ];
  if (mode !== "old") flags.push("--session-id");
  console.log(flags.join("\n"));
  process.exit(0);
}
if (args[0] === "auth") {
  console.log(
    JSON.stringify({
      loggedIn: mode !== "logged-out",
      authMethod: "claude.ai",
      subscriptionType: "pro",
      email: "someone@example.com",
    }),
  );
  process.exit(mode === "logged-out" ? 1 : 0);
}

log({ argv: args });
const sessionId = args[args.indexOf("--resume") + 1] ?? args[args.indexOf("--session-id") + 1];
const send = (value: unknown): undefined => {
  process.stdout.write(`${JSON.stringify(value)}\n`);
};
const waiting = new Map<string, (response: Record<string, unknown>) => void>();
let interrupted: (() => void) | null = null;

const event = (e: unknown) =>
  send({ type: "stream_event", event: e, parent_tool_use_id: null, session_id: sessionId });
const text = (body: string, chunks: string[]) => {
  event({ type: "message_start", message: { id: "msg" } });
  event({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
  for (const chunk of chunks)
    event({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: chunk } });
  send({
    type: "assistant",
    message: { id: "msg", content: [{ type: "text", text: body }] },
    parent_tool_use_id: null,
  });
  event({ type: "content_block_stop", index: 0 });
};
const result = (subtype = "success") =>
  send({ type: "result", subtype, is_error: subtype !== "success", session_id: sessionId });
const toolUse = (id: string, name: string, input: unknown) =>
  send({
    type: "assistant",
    message: { id: `m-${id}`, content: [{ type: "tool_use", id, name, input }] },
    parent_tool_use_id: null,
  });

async function ask(id: string, name: string, input: unknown): Promise<Record<string, unknown>> {
  const requestId = `perm-${id}`;
  const answer = new Promise<Record<string, unknown>>((resolve) => waiting.set(requestId, resolve));
  send({
    type: "control_request",
    request_id: requestId,
    request: {
      subtype: "can_use_tool",
      tool_name: name,
      input,
      tool_use_id: id,
      // As Claude Code proposes them: the tool's own rule for the project's
      // local settings, and an incidental one for the session.
      permission_suggestions: [
        {
          type: "addRules",
          rules: [{ toolName: name, ruleContent: "a.txt" }],
          behavior: "allow",
          destination: "localSettings",
        },
        {
          type: "addRules",
          rules: [{ toolName: "Read", ruleContent: "//app/**" }],
          behavior: "allow",
          destination: "session",
        },
      ],
    },
  });
  return answer;
}

async function turn(prompt: string) {
  send({
    type: "system",
    subtype: "init",
    session_id: sessionId,
    model: "claude-test",
    permissionMode: "default",
    mcp_servers: [{ name: "velloo", status: mode === "mcp-failed" ? "failed" : "connected" }],
  });
  if (prompt.includes("crash")) {
    process.stderr.write("fatal: the API is unreachable\n");
    process.exit(1);
  }
  if (prompt.includes("expired")) {
    send({
      type: "result",
      subtype: "error_during_execution",
      is_error: true,
      errors: ["Failed to authenticate: OAuth session expired"],
    });
    return;
  }
  if (prompt.includes("garbage")) process.stdout.write("this is not json\n");
  if (prompt.includes("withdrawn")) {
    toolUse("tw", "Bash", { command: "rm -rf /tmp/x" });
    send({
      type: "control_request",
      request_id: "perm-tw",
      request: {
        subtype: "can_use_tool",
        tool_name: "Bash",
        input: { command: "rm -rf /tmp/x" },
        tool_use_id: "tw",
      },
    });
    await new Promise((r) => setTimeout(r, 50));
    send({ type: "control_cancel_request", request_id: "perm-tw" });
    send({
      type: "control_request",
      request_id: "hook-1",
      request: { subtype: "hook_callback", callback_id: "x" },
    });
    await new Promise((r) => setTimeout(r, 50));
  }
  if (prompt.includes("write")) {
    const input = { file_path: "/app/a.txt", content: "x" };
    toolUse("tu1", "Write", input);
    const response = await ask("tu1", "Write", input);
    log({ permission: response });
    const allowed = response.behavior === "allow";
    send({
      type: "user",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "tu1",
            is_error: !allowed,
            content: allowed ? "ok" : String(response.message),
          },
        ],
      },
      tool_use_result: allowed ? { type: "create" } : undefined,
      parent_tool_use_id: null,
    });
    if (response.interrupt) return result("error_during_execution");
  }
  if (prompt.includes("question")) {
    const input = {
      questions: [
        {
          question: "Which colour?",
          header: "Colour",
          options: [
            { label: "Red", description: "Warm" },
            { label: "Blue", description: "Cool" },
          ],
          multiSelect: false,
        },
        {
          question: "Which sizes?",
          header: "Sizes",
          options: [
            { label: "S", description: "" },
            { label: "M", description: "" },
          ],
          multiSelect: true,
        },
      ],
    };
    toolUse("tq", "AskUserQuestion", input);
    log({ permission: await ask("tq", "AskUserQuestion", input) });
  }
  if (prompt.includes("bash")) {
    toolUse("tu2", "Bash", { command: "echo hi", description: "Say hi" });
    send({
      type: "user",
      message: {
        content: [{ type: "tool_result", tool_use_id: "tu2", is_error: false, content: "hi" }],
      },
      tool_use_result: { stdout: "hi", stderr: "" },
      parent_tool_use_id: null,
    });
    toolUse("tu3", "mcp__velloo__compose", { screen: "home" });
    send({
      type: "user",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "tu3",
            content: [{ type: "text", text: "Composed." }],
          },
        ],
      },
      parent_tool_use_id: null,
    });
  }
  if (prompt.includes("long")) {
    event({ type: "message_start", message: { id: "long" } });
    event({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
    await new Promise<void>((resolve) => {
      interrupted = resolve;
      event({
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "Once upon" },
      });
    });
    send({
      type: "user",
      message: { content: [{ type: "text", text: "[Request interrupted by user]" }] },
      parent_tool_use_id: null,
    });
    return result("error_during_execution");
  }
  text("Hello there", ["Hello", " there"]);
  return result();
}

let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += chunk.toString();
  let newline = buffer.indexOf("\n");
  while (newline >= 0) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    newline = buffer.indexOf("\n");
    if (!line) continue;
    const m = JSON.parse(line);
    if (m.type === "control_request" && m.request.subtype === "initialize") {
      send({
        type: "control_response",
        response: {
          subtype: "success",
          request_id: m.request_id,
          response: {
            claude_code_version: "2.1.300",
            current_permission_mode: "default",
            commands: [
              { name: "review", description: "Review the changes", argumentHint: "[pr]" },
              { name: "compact", description: "", argumentHint: "" },
              { description: "a command without a name" },
            ],
            models: [
              { value: "default", displayName: "Default", resolvedModel: "claude-test" },
              {
                value: "sonnet",
                displayName: "Sonnet",
                description: "Fast",
                resolvedModel: "claude-sonnet-test",
              },
            ],
          },
        },
      });
    } else if (m.type === "control_request" && m.request.subtype === "get_settings") {
      send({
        type: "control_response",
        response: {
          subtype: "success",
          request_id: m.request_id,
          response: { effective: { model: "sonnet" }, applied: { model: "claude-sonnet-test" } },
        },
      });
    } else if (m.type === "control_request" && m.request.subtype === "set_model") {
      log({ setModel: m.request.model });
      send({
        type: "control_response",
        response: {
          subtype: "success",
          request_id: m.request_id,
          response: { model: m.request.model === "sonnet" ? "claude-sonnet-test" : "claude-test" },
        },
      });
    } else if (m.type === "control_request" && m.request.subtype === "set_permission_mode") {
      log({ setMode: m.request.mode });
      send({
        type: "control_response",
        response: { subtype: "success", request_id: m.request_id, response: {} },
      });
    } else if (m.type === "control_request" && m.request.subtype === "mcp_status") {
      send({
        type: "control_response",
        response: {
          subtype: "success",
          request_id: m.request_id,
          response: {
            mcpServers: [
              { name: "velloo", status: "connected", scope: "dynamic", tools: [{}, {}] },
              { name: "github", status: "failed", scope: "user", error: "spawn ENOENT" },
              { name: "linear", status: "needs-auth", scope: "dynamic", source: "plugin" },
              { name: "odd", status: "sleeping" },
            ],
          },
        },
      });
    } else if (
      m.type === "control_request" &&
      (m.request.subtype === "mcp_toggle" || m.request.subtype === "mcp_reconnect")
    ) {
      log({ mcp: m.request });
      send({
        type: "control_response",
        response:
          m.request.serverName === "broken"
            ? { subtype: "error", request_id: m.request_id, error: "No such server" }
            : { subtype: "success", request_id: m.request_id, response: {} },
      });
    } else if (m.type === "control_request" && m.request.subtype === "interrupt") {
      send({
        type: "control_response",
        response: { subtype: "success", request_id: m.request_id, response: {} },
      });
      interrupted?.();
    } else if (m.type === "control_response") {
      if (m.response.subtype === "error") log({ controlError: m.response });
      waiting.get(m.response.request_id)?.(m.response.response);
    } else if (m.type === "user") {
      void turn(String(m.message.content));
    }
  }
});
process.stdin.on("end", () => process.exit(0));
