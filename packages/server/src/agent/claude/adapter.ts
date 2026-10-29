import { hostname } from "node:os";
import type {
  AgentAnswers,
  AgentApprovalDecision,
  AgentCapabilities,
  AgentCommand,
  AgentItem,
  AgentMcpAction,
  AgentMcpServer,
  AgentModelOption,
  AgentModeOption,
  AgentProviderInfo,
} from "@velloo/protocol/agent";
import {
  type AgentAdapter,
  type AgentConnection,
  AgentError,
  type AgentLaunch,
  type AgentSink,
} from "../adapter.ts";
import { asRecord } from "../json.ts";
import { findExecutable, JsonLineProcess, parseVersion, runOnce } from "../process.ts";
import {
  answeredInput,
  approvalFor,
  permissionChoices,
  toolUseItem,
  withResult,
} from "./normalize.ts";
import { listClaudeSessions, readClaudeTranscript } from "./transcript.ts";

const LABEL = "Claude Code";
const INSTALL =
  "Install Claude Code (`curl -fsSL https://claude.ai/install.sh | bash` or `npm install -g @anthropic-ai/claude-code`), then check again.";
const UPGRADE = "Update Claude Code (`claude update`), then check again.";

/** Flags a session can't run without; checked against the installed CLI's own help. */
const REQUIRED_FLAGS = [
  "--input-format",
  "--output-format",
  "--mcp-config",
  "--append-system-prompt",
  "--resume",
  "--session-id",
];

const CAPABILITIES: AgentCapabilities = {
  resume: true,
  history: true,
  rename: false,
  interrupt: true,
  followUp: "queue",
  approvals: ["allow-once", "allow-session", "allow-always", "deny", "abort"],
  turnDiff: false,
};

const SUBSCRIPTIONS: Record<string, string> = {
  pro: "Claude Pro",
  max: "Claude Max",
  team: "Claude Team",
  enterprise: "Claude Enterprise",
};

export interface ClaudeAdapterOptions {
  /** The command that runs Claude Code, for tests; found on PATH otherwise. */
  command?: string[];
}

/**
 * Claude Code through its print mode with stream-json in both directions —
 * the interface its Agent SDK drives. It runs as the person's own installed
 * CLI: their login, settings, hooks, MCP servers and permission rules apply,
 * and anything those rules would ask about comes to Velloo as a `can_use_tool`
 * control request (`--permission-prompt-tool stdio`). Velloo never passes a
 * permission mode, so it can neither widen nor narrow what the person chose.
 */
export class ClaudeCodeAdapter implements AgentAdapter {
  readonly id = "claude-code";
  readonly label = LABEL;
  private readonly compat = new Map<string, Promise<string[] | null>>();

  constructor(private readonly options: ClaudeAdapterOptions = {}) {}

  private command(): string[] | null {
    if (this.options.command) return this.options.command;
    const exe = findExecutable("claude");
    return exe ? [exe] : null;
  }

  async discover(): Promise<AgentProviderInfo> {
    const base = { id: this.id, label: LABEL, capabilities: CAPABILITIES };
    const command = this.command();
    if (!command)
      return {
        ...base,
        status: "not-installed",
        message: `Claude Code isn't installed. ${INSTALL}`,
      };
    const version = parseVersion(await runOnce([...command, "--version"]));
    if (!version) {
      return {
        ...base,
        status: "error",
        message: "`claude --version` didn't answer. Check that Claude Code runs in a terminal.",
      };
    }
    const missing = await this.missingFlags(command, version);
    if (missing === null || missing.length > 0) {
      return {
        ...base,
        status: "incompatible",
        version,
        message: `Claude Code ${version} doesn't support ${missing?.join(", ") ?? "structured sessions"}. ${UPGRADE}`,
      };
    }
    const auth = asRecord(
      safeJson(
        await runOnce([...command, "auth", "status", "--json"], undefined, undefined, {
          anyExit: true,
        }),
      ),
    );
    if (auth.loggedIn === false) {
      return {
        ...base,
        status: "logged-out",
        version,
        message:
          "Claude Code isn't signed in. Run `claude` in a terminal and sign in, then check again.",
      };
    }
    const account =
      typeof auth.subscriptionType === "string"
        ? SUBSCRIPTIONS[auth.subscriptionType]
        : auth.authMethod === "apiKey" || auth.authMethod === "api_key"
          ? "API key"
          : undefined;
    return { ...base, status: "ready", version, ...(account ? { account } : {}) };
  }

  async start(launch: AgentLaunch, sink: AgentSink): Promise<AgentConnection> {
    const command = this.command();
    if (!command) throw new AgentError("unavailable", `Claude Code isn't installed. ${INSTALL}`);
    const session = new ClaudeSession(command, launch, sink);
    await session.open();
    // Claude Code doesn't replay a resumed conversation, so a session started
    // outside the tab is read from its transcript. One Velloo already holds
    // turns for keeps them; the manager ignores history then.
    if (launch.resume) sink.history(await readClaudeTranscript(launch.cwd, launch.resume));
    return session;
  }

  history(cwd: string) {
    return listClaudeSessions(cwd);
  }

  /** Which required flags this version lacks, read once per version from its help. */
  private missingFlags(command: string[], version: string): Promise<string[] | null> {
    const key = `${command.join(" ")}@${version}`;
    let cached = this.compat.get(key);
    if (!cached) {
      cached = runOnce([...command, "--help"]).then((help) => {
        // A probe that failed (a slow first run, say) is asked again next time.
        if (help === null) this.compat.delete(key);
        return help === null ? null : REQUIRED_FLAGS.filter((flag) => !help.includes(flag));
      });
      this.compat.set(key, cached);
    }
    return cached;
  }
}

function safeJson(text: string | null): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Claude Code's permission modes, as its own mode switcher describes them.
 * `bypassPermissions` is left out: turning every check off stays a choice
 * made in Claude Code itself.
 */
const MODES: AgentModeOption[] = [
  { id: "default", label: "Ask", description: "Asks before edits and commands, by your rules" },
  {
    id: "acceptEdits",
    label: "Accept edits",
    description: "Edits files without asking; asks before commands",
  },
  { id: "plan", label: "Plan", description: "Reads and plans; changes nothing" },
  { id: "auto", label: "Auto", description: "Runs what it judges safe; asks about anything risky" },
  {
    id: "dontAsk",
    label: "Don't ask",
    description: "Does only what your rules allow, and refuses the rest",
  },
];

const MCP_STATUS: Record<string, AgentMcpServer["status"]> = {
  connected: "connected",
  pending: "starting",
  "needs-auth": "needs-auth",
  failed: "failed",
  disabled: "disabled",
};

const SCOPES: Record<string, string> = {
  user: "Your settings",
  project: "This project",
  local: "This project, just you",
  plugin: "A plugin",
  claudeai: "claude.ai",
  dynamic: "Added for this session",
  enterprise: "Your organization",
};

function commandsFrom(raw: unknown): AgentCommand[] {
  return (Array.isArray(raw) ? raw : []).flatMap((entry) => {
    const c = asRecord(entry);
    if (typeof c.name !== "string" || !c.name) return [];
    return [
      {
        name: c.name,
        ...(typeof c.description === "string" && c.description
          ? { description: c.description }
          : {}),
        ...(typeof c.argumentHint === "string" && c.argumentHint
          ? { argumentHint: c.argumentHint }
          : {}),
      },
    ];
  });
}

function modelsFrom(raw: unknown): (AgentModelOption & { resolved?: string })[] {
  return (Array.isArray(raw) ? raw : []).flatMap((entry) => {
    const m = asRecord(entry);
    if (typeof m.value !== "string" || !m.value) return [];
    return [
      {
        id: m.value,
        label: typeof m.displayName === "string" ? m.displayName : m.value,
        ...(typeof m.description === "string" && m.description
          ? { description: m.description }
          : {}),
        ...(typeof m.resolvedModel === "string" ? { resolved: m.resolvedModel } : {}),
      },
    ];
  });
}

interface Permission {
  requestId: string;
  input: Record<string, unknown>;
  sessionRules: unknown[];
  savedRules: unknown[];
  toolUseId: string | undefined;
}

/** One running `claude -p` process, and the conversation it carries. */
class ClaudeSession implements AgentConnection {
  private readonly proc: JsonLineProcess;
  private readonly sessionId: string;
  private turnId: string | null = null;
  private interrupting = false;
  private closing = false;
  private warnedMalformed = false;
  private nextRequest = 1;
  private readonly controls = new Map<
    string,
    { resolve(v: unknown): void; reject(e: Error): void }
  >();
  private readonly permissions = new Map<string, Permission>();
  /** Items by tool_use id, to settle them when their result arrives. */
  private readonly tools = new Map<string, AgentItem>();
  /** Tool calls the person refused, which settle as declined rather than failed. */
  private readonly declined = new Set<string>();
  /** The content block the partial stream is filling: the next `assistant` line is its whole value. */
  private openBlock: { itemId: string; kind: "text" | "thinking" } | null = null;
  private blockCount = 0;
  private version: string | undefined;
  private commands: AgentCommand[] = [];
  /** `resolved` is the model id the system message reports, to find the option it came from. */
  private models: (AgentModelOption & { resolved?: string })[] = [];
  private model: string | undefined;
  private mode: string | undefined;

  constructor(
    command: string[],
    private readonly launch: AgentLaunch,
    private readonly sink: AgentSink,
  ) {
    this.sessionId = launch.resume ?? crypto.randomUUID();
    const args = [
      ...command,
      "-p",
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--permission-prompt-tool",
      "stdio",
      "--append-system-prompt",
      launch.instructions,
      ...(launch.resume ? [`--resume=${launch.resume}`] : ["--session-id", this.sessionId]),
      ...(launch.mcp
        ? [
            "--mcp-config",
            JSON.stringify({
              mcpServers: { [launch.mcp.name]: { type: "http", url: launch.mcp.url } },
            }),
          ]
        : []),
    ];
    this.proc = new JsonLineProcess(args, launch.cwd, {
      message: (value) => this.onMessage(asRecord(value)),
      malformed: () => {
        if (this.warnedMalformed) return;
        this.warnedMalformed = true;
        this.sink.notice(
          "warning",
          "Claude Code sent a line Velloo couldn't read; it was skipped.",
        );
      },
      exit: (code, stderr) => {
        const reason = this.closing
          ? undefined
          : stderr.split("\n").filter(Boolean).at(-1) ||
            `Claude Code exited with code ${code ?? "unknown"}.`;
        for (const pending of this.controls.values())
          pending.reject(new AgentError("unavailable", reason ?? "Claude Code stopped."));
        this.controls.clear();
        this.sink.exited(reason);
      },
    });
  }

  async open(): Promise<void> {
    try {
      const init = asRecord(await this.control({ subtype: "initialize" }, 60_000));
      this.version =
        typeof init.claude_code_version === "string" ? init.claude_code_version : undefined;
      this.commands = commandsFrom(init.commands);
      this.mode =
        typeof init.current_permission_mode === "string" ? init.current_permission_mode : undefined;
      this.models = modelsFrom(init.models);
      // The model only arrives with the first turn otherwise; the settings
      // Claude resolved say it before anything is sent.
      const settings = asRecord(
        await this.control({ subtype: "get_settings" }, 10_000).catch(() => undefined),
      );
      const applied = asRecord(settings.applied).model;
      const model = typeof applied === "string" ? applied : undefined;
      if (model) this.runsOn(model);
      this.publishControls();
      this.ready(
        typeof init.current_permission_mode === "string" ? init.current_permission_mode : undefined,
        model,
      );
    } catch (error) {
      await this.close();
      throw new AgentError(
        "unavailable",
        `Claude Code couldn't start: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private ready(mode: string | undefined, model?: string): void {
    this.sink.ready({
      providerSessionId: this.sessionId,
      environment: {
        execution: "local",
        host: hostname(),
        cwd: this.launch.cwd,
        sandbox: mode ?? "default",
        approvalMode: "your Claude Code permission rules",
        ...(model ? { model } : {}),
        ...(this.version ? { providerVersion: this.version } : {}),
      },
      resumable: true,
      terminalCommand: ["claude", "--resume", this.sessionId],
    });
  }

  async startTurn(text: string): Promise<string> {
    const turnId = this.beginTurn();
    this.proc.write({
      type: "user",
      message: { role: "user", content: text },
      parent_tool_use_id: null,
      session_id: this.sessionId,
    });
    return turnId;
  }

  async interrupt(): Promise<void> {
    if (!this.turnId) return;
    this.interrupting = true;
    await this.control({ subtype: "interrupt" }, 15_000);
  }

  async answer(
    approvalId: string,
    decision: AgentApprovalDecision,
    answers?: AgentAnswers,
  ): Promise<void> {
    const permission = this.permissions.get(approvalId);
    if (!permission) throw new AgentError("not-found", "That request is no longer waiting.");
    this.permissions.delete(approvalId);
    const allow = decision.startsWith("allow-");
    const rules =
      decision === "allow-session"
        ? permission.sessionRules
        : decision === "allow-always"
          ? permission.savedRules
          : [];
    const response = allow
      ? {
          behavior: "allow",
          updatedInput: answers ? answeredInput(permission.input, answers) : permission.input,
          ...(rules.length ? { updatedPermissions: rules } : {}),
        }
      : {
          behavior: "deny",
          message:
            decision === "abort"
              ? "The person stopped this turn from the Velloo canvas."
              : "The person declined this in the Velloo canvas.",
          ...(decision === "abort" ? { interrupt: true } : {}),
        };
    if (decision === "abort") this.interrupting = true;
    if (!allow && permission.toolUseId) this.declined.add(permission.toolUseId);
    this.proc.write({
      type: "control_response",
      response: { subtype: "success", request_id: permission.requestId, response },
    });
  }

  async close(): Promise<void> {
    this.closing = true;
    await this.proc.close();
  }

  async setModel(model: string): Promise<string | undefined> {
    const answer = asRecord(await this.control({ subtype: "set_model", model }, 15_000));
    this.model = model;
    return typeof answer.model === "string" ? answer.model : undefined;
  }

  async setMode(mode: string): Promise<{ sandbox: string }> {
    await this.control({ subtype: "set_permission_mode", mode }, 15_000);
    this.mode = mode;
    return { sandbox: mode };
  }

  async mcpServers(): Promise<AgentMcpServer[]> {
    const answer = asRecord(await this.control({ subtype: "mcp_status" }, 30_000));
    return (Array.isArray(answer.mcpServers) ? answer.mcpServers : []).map((raw) => {
      const server = asRecord(raw);
      const error = typeof server.error === "string" ? server.error : undefined;
      const where =
        server.source === "plugin"
          ? SCOPES.plugin
          : typeof server.scope === "string"
            ? SCOPES[server.scope]
            : undefined;
      const detail = error ?? where;
      return {
        name: String(server.name ?? ""),
        status: MCP_STATUS[String(server.status)] ?? "unknown",
        ...(detail ? { detail } : {}),
        ...(Array.isArray(server.tools) ? { tools: server.tools.length } : {}),
      };
    });
  }

  async mcpAction(server: string, action: AgentMcpAction): Promise<void> {
    await this.control(
      action === "reconnect"
        ? { subtype: "mcp_reconnect", serverName: server }
        : { subtype: "mcp_toggle", serverName: server, enabled: action === "enable" },
      30_000,
    );
  }

  private publishControls(): void {
    this.sink.controls({
      commands: this.commands,
      models: this.models.map(({ resolved: _resolved, ...option }) => option),
      ...(this.model ? { model: this.model } : {}),
      modes: MODES,
      ...(this.mode ? { mode: this.mode } : {}),
      mcp: { actions: ["reconnect", "enable", "disable"] },
    });
  }

  private beginTurn(): string {
    const turnId = `turn-${crypto.randomUUID()}`;
    this.turnId = turnId;
    this.interrupting = false;
    this.sink.turnStarted(turnId);
    return turnId;
  }

  /** The turn an event belongs to — Claude Code can start one on its own (a background task finished). */
  private currentTurn(): string {
    return this.turnId ?? this.beginTurn();
  }

  private control(request: Record<string, unknown>, timeoutMs: number): Promise<unknown> {
    const requestId = `velloo-${this.nextRequest++}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.controls.delete(requestId);
        reject(new Error(`Claude Code didn't answer ${String(request.subtype)} in time.`));
      }, timeoutMs);
      this.controls.set(requestId, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.proc.write({ type: "control_request", request_id: requestId, request });
    });
  }

  private onMessage(m: Record<string, unknown>): void {
    // Subagents' own messages are summarised by their Task item, not replayed.
    const nested = Boolean(m.parent_tool_use_id);
    if (m.type === "control_response") this.onControlResponse(asRecord(m.response));
    else if (m.type === "control_request") {
      this.onControlRequest(String(m.request_id ?? ""), asRecord(m.request));
    } else if (m.type === "control_cancel_request") {
      for (const [approvalId, p] of this.permissions) {
        if (p.requestId === m.request_id) {
          this.permissions.delete(approvalId);
          this.sink.approvalWithdrawn(approvalId);
        }
      }
    } else if (m.type === "system") this.onSystem(m);
    else if (m.type === "stream_event" && !nested) this.onStreamEvent(asRecord(m.event));
    else if (m.type === "assistant" && !nested) this.onAssistant(asRecord(m.message));
    else if (m.type === "user") this.onUser(m);
    else if (m.type === "result") this.onResult(m);
  }

  private onControlResponse(response: Record<string, unknown>): void {
    const pending = this.controls.get(String(response.request_id ?? ""));
    if (!pending) return;
    this.controls.delete(String(response.request_id));
    if (response.subtype === "error")
      pending.reject(new Error(String(response.error ?? "Claude Code refused a request.")));
    else pending.resolve(response.response);
  }

  private onControlRequest(requestId: string, request: Record<string, unknown>): void {
    if (request.subtype !== "can_use_tool") {
      // Hook callbacks and SDK-hosted MCP servers: Velloo registers neither.
      this.proc.write({
        type: "control_response",
        response: {
          subtype: "error",
          request_id: requestId,
          error: `Velloo doesn't handle ${String(request.subtype)}.`,
        },
      });
      return;
    }
    const suggestions = Array.isArray(request.permission_suggestions)
      ? request.permission_suggestions
      : [];
    const choices = permissionChoices(suggestions);
    const approvalId = `claude-${requestId}`;
    this.permissions.set(approvalId, {
      requestId,
      input: asRecord(request.input),
      sessionRules: choices.session,
      savedRules: choices.saved,
      toolUseId: typeof request.tool_use_id === "string" ? request.tool_use_id : undefined,
    });
    this.currentTurn();
    this.sink.approval({
      ...approvalFor(request, this.launch.cwd, {
        session: choices.session.length > 0,
        always: choices.always,
      }),
      id: approvalId,
      ...(this.turnId ? { turnId: this.turnId } : {}),
    });
  }

  private onSystem(m: Record<string, unknown>): void {
    if (m.subtype === "init") {
      const servers = Array.isArray(m.mcp_servers) ? m.mcp_servers.map(asRecord) : [];
      const velloo = servers.find((s) => s.name === this.launch.mcp?.name);
      if (this.launch.mcp && velloo && velloo.status !== "connected") {
        this.sink.notice(
          "error",
          `The Velloo MCP server isn't connected in Claude Code (${String(velloo.status)}). Design edits won't reach the canvas.`,
        );
      }
      const model = typeof m.model === "string" ? m.model : undefined;
      const mode = typeof m.permissionMode === "string" ? m.permissionMode : undefined;
      this.ready(mode, model);
      if (mode && mode !== this.mode) {
        this.mode = mode;
        this.publishControls();
      }
      if (model) this.runsOn(model);
    }
  }

  /**
   * The option `model` is: the one chosen, while it still resolves to it,
   * else the first that does ("Default" before "Opus").
   */
  private runsOn(model: string): void {
    const chosen = this.models.find((o) => o.id === this.model);
    if (chosen?.resolved === model) return;
    const found = this.models.find((o) => o.resolved === model || o.id === model)?.id;
    if (found !== this.model) {
      this.model = found;
      this.publishControls();
    }
  }

  private onStreamEvent(event: Record<string, unknown>): void {
    const turnId = this.currentTurn();
    if (event.type === "content_block_start") {
      const block = asRecord(event.content_block);
      const messageId = `b-${turnId}-${this.blockCount++}`;
      if (block.type === "text") {
        this.openBlock = { itemId: messageId, kind: "text" };
        this.sink.item(turnId, { kind: "agent-text", id: messageId, text: "" });
      } else if (block.type === "thinking") {
        this.openBlock = { itemId: messageId, kind: "thinking" };
      } else this.openBlock = null;
      return;
    }
    if (event.type === "content_block_delta") {
      const delta = asRecord(event.delta);
      if (!this.openBlock) return;
      if (delta.type === "text_delta" && typeof delta.text === "string") {
        this.sink.delta(turnId, this.openBlock.itemId, "text", delta.text);
      } else if (
        delta.type === "thinking_delta" &&
        typeof delta.thinking === "string" &&
        delta.thinking
      ) {
        this.sink.item(turnId, { kind: "reasoning", id: this.openBlock.itemId, text: "" });
        this.sink.delta(turnId, this.openBlock.itemId, "text", delta.thinking);
      }
      return;
    }
    if (event.type === "content_block_stop") this.openBlock = null;
  }

  private onAssistant(message: Record<string, unknown>): void {
    const turnId = this.currentTurn();
    const content = Array.isArray(message.content) ? message.content.map(asRecord) : [];
    for (const block of content) {
      if (block.type === "text" && typeof block.text === "string") {
        const id =
          this.openBlock?.kind === "text"
            ? this.openBlock.itemId
            : `b-${turnId}-${this.blockCount++}`;
        this.sink.item(turnId, { kind: "agent-text", id, text: block.text });
      } else if (
        block.type === "thinking" &&
        typeof block.thinking === "string" &&
        block.thinking
      ) {
        const id =
          this.openBlock?.kind === "thinking"
            ? this.openBlock.itemId
            : `b-${turnId}-${this.blockCount++}`;
        this.sink.item(turnId, { kind: "reasoning", id, text: block.thinking });
      } else if (block.type === "tool_use" && typeof block.id === "string") {
        const item = toolUseItem(
          block.id,
          String(block.name ?? "tool"),
          block.input,
          this.launch.cwd,
        );
        this.tools.set(block.id, item);
        this.sink.item(turnId, item);
      }
    }
  }

  private onUser(m: Record<string, unknown>): void {
    const content = asRecord(m.message).content;
    if (!Array.isArray(content)) return;
    const turnId = this.currentTurn();
    for (const raw of content.map(asRecord)) {
      if (raw.type !== "tool_result" || typeof raw.tool_use_id !== "string") continue;
      const item = this.tools.get(raw.tool_use_id);
      if (!item) continue;
      const result = withResult(item, raw.content, raw.is_error === true, m.tool_use_result);
      const settled =
        this.declined.delete(raw.tool_use_id) && "status" in result
          ? ({ ...result, status: "declined" } as AgentItem)
          : result;
      this.tools.set(raw.tool_use_id, settled);
      this.sink.item(turnId, settled);
    }
  }

  private onResult(m: Record<string, unknown>): void {
    const turnId = this.turnId;
    if (!turnId) return;
    this.turnId = null;
    this.openBlock = null;
    // Tool calls the turn left unsettled (an interrupt mid-command) end with it.
    for (const [id, item] of this.tools) {
      if ("status" in item && item.status === "running") {
        this.sink.item(turnId, { ...item, status: "failed" } as AgentItem);
        this.tools.delete(id);
      }
    }
    if (this.interrupting) {
      this.interrupting = false;
      this.sink.turnCompleted(turnId, "interrupted");
      return;
    }
    if (m.subtype === "success" && m.is_error !== true) {
      this.sink.turnCompleted(turnId, "completed");
      return;
    }
    const errors = Array.isArray(m.errors) ? m.errors.filter((e) => typeof e === "string") : [];
    const message =
      errors[0] ??
      (typeof m.result === "string" && m.result ? m.result : undefined) ??
      (m.subtype === "error_max_turns"
        ? "Claude Code reached its turn limit."
        : "Claude Code couldn't finish this turn.");
    this.sink.turnCompleted(
      turnId,
      "failed",
      /authenticat|oauth|log ?in|sign ?in/i.test(message)
        ? `${message} Sign in again by running \`claude\` in a terminal, then retry.`
        : message,
    );
  }
}
