import { hostname } from "node:os";
import type {
  AgentApprovalDecision,
  AgentCapabilities,
  AgentItem,
  AgentProviderInfo,
  AgentTurn,
} from "@velloo/protocol/agent";
import {
  type AgentAdapter,
  type AgentConnection,
  AgentError,
  type AgentLaunch,
  type AgentSink,
} from "../adapter.ts";
import { summarize } from "../bounds.ts";
import { asRecord } from "../json.ts";
import { JsonRpc, RpcError, type RpcId } from "../json-rpc.ts";
import { findExecutable, JsonLineProcess, parseVersion } from "../process.ts";
import { contentText, permissionDecisions, toolCallItem } from "./normalize.ts";

/** The Agent Client Protocol version this client speaks. */
const ACP_VERSION = 1;

/** A CLI agent that speaks ACP, and how to run and set it up. */
export interface AcpAgentSpec {
  id: string;
  label: string;
  /** The executable, found on PATH. */
  executable: string;
  /** Arguments that put it in ACP mode. */
  args: string[];
  install: string;
  /** What signs it in, shown when a session needs it. */
  signIn: string;
}

/**
 * The ACP agents Velloo knows how to start, with the commands the ACP registry
 * (agentclientprotocol.com/registry) gives for them. Unlike Codex and Claude
 * Code they are offered only once installed and compatible — the picker lists
 * what the person can use, not every agent that exists.
 */
export const ACP_AGENTS: AcpAgentSpec[] = [
  {
    id: "opencode",
    label: "OpenCode",
    executable: "opencode",
    args: ["acp"],
    install: "Install OpenCode (`curl -fsSL https://opencode.ai/install | bash`).",
    signIn: "Run `opencode auth login` in a terminal.",
  },
  {
    id: "github-copilot",
    label: "GitHub Copilot",
    executable: "copilot",
    args: ["--acp"],
    install: "Install the Copilot CLI (`npm install -g @github/copilot`).",
    signIn: "Run `copilot` in a terminal and sign in with `/login`.",
  },
  {
    id: "cursor",
    label: "Cursor",
    executable: "cursor-agent",
    args: ["acp"],
    install: "Install the Cursor CLI (`curl https://cursor.com/install -fsS | bash`).",
    signIn: "Run `cursor-agent login` in a terminal.",
  },
  {
    id: "gemini",
    label: "Gemini CLI",
    executable: "gemini",
    args: ["--acp"],
    install: "Install Gemini CLI (`npm install -g @google/gemini-cli`).",
    signIn: "Run `gemini` in a terminal and sign in.",
  },
  {
    id: "qwen-code",
    label: "Qwen Code",
    executable: "qwen",
    args: ["--acp"],
    install: "Install Qwen Code (`npm install -g @qwen-code/qwen-code`).",
    signIn: "Run `qwen` in a terminal and sign in.",
  },
  {
    id: "kimi",
    label: "Kimi CLI",
    executable: "kimi",
    args: ["acp"],
    install: "Install Kimi CLI (`uv tool install kimi-cli`).",
    signIn: "Run `kimi` in a terminal and sign in with `/login`.",
  },
  {
    id: "mistral-vibe",
    label: "Mistral Vibe",
    executable: "vibe-acp",
    args: [],
    install: "Install Mistral Vibe (`uv tool install mistral-vibe`).",
    signIn: "Run `vibe` in a terminal and set it up.",
  },
  {
    id: "cline",
    label: "Cline",
    executable: "cline",
    args: ["--acp"],
    install: "Install the Cline CLI (`npm install -g cline`).",
    signIn: "Run `cline auth` in a terminal.",
  },
  {
    id: "kilo",
    label: "Kilo",
    executable: "kilo",
    args: ["acp"],
    install: "Install the Kilo CLI (`npm install -g @kilocode/cli`).",
    signIn: "Run `kilo` in a terminal and sign in.",
  },
  {
    id: "auggie",
    label: "Auggie",
    executable: "auggie",
    args: ["--acp"],
    install: "Install Auggie (`npm install -g @augmentcode/auggie`).",
    signIn: "Run `auggie login` in a terminal.",
  },
  {
    id: "factory-droid",
    label: "Factory Droid",
    executable: "droid",
    args: ["exec", "--output-format", "acp-daemon"],
    install: "Install Droid (`curl -fsSL https://app.factory.ai/cli | sh`).",
    signIn: "Run `droid` in a terminal and sign in.",
  },
  {
    id: "goose",
    label: "Goose",
    executable: "goose",
    args: ["acp"],
    install: "Install Goose (see block.github.io/goose).",
    signIn: "Run `goose configure` in a terminal.",
  },
];

/** ACP's "authentication required" error. */
const AUTH_REQUIRED = -32000;

interface Advertised {
  version: string | undefined;
  capabilities: AgentCapabilities;
  mcpHttp: boolean;
  loadSession: boolean;
}

function advertised(init: Record<string, unknown>): Advertised {
  const caps = asRecord(init.agentCapabilities);
  const loadSession = caps.loadSession === true;
  const info = asRecord(init.agentInfo);
  return {
    version: parseVersion(typeof info.version === "string" ? info.version : null) ?? undefined,
    loadSession,
    mcpHttp: asRecord(caps.mcpCapabilities).http === true,
    capabilities: {
      resume: loadSession,
      history: false,
      rename: false,
      interrupt: true,
      // ACP has no way to add to a running prompt; a follow-up waits its turn.
      followUp: "queue",
      approvals: ["allow-once", "deny", "abort"],
      turnDiff: false,
    },
  };
}

const CLIENT_CAPABILITIES = {
  // Velloo hands the agent neither its file system nor a terminal: the agent
  // uses its own, under its own permissions.
  fs: { readTextFile: false, writeTextFile: false },
  terminal: false,
};

export interface AcpAdapterOptions {
  /** The command that runs the agent in ACP mode, for tests; found on PATH otherwise. */
  command?: string[];
}

/**
 * Any agent that speaks the Agent Client Protocol (agentclientprotocol.com):
 * JSON-RPC over the child's stdio, the protocol editors use to host CLI
 * agents. Capabilities come from what the agent advertises in `initialize`.
 */
export class AcpAdapter implements AgentAdapter {
  readonly id: string;
  readonly label: string;
  /** Not installed or not compatible, and it isn't offered at all. */
  readonly hiddenUnlessReady = true;

  constructor(
    private readonly spec: AcpAgentSpec,
    private readonly options: AcpAdapterOptions = {},
  ) {
    this.id = spec.id;
    this.label = spec.label;
  }

  private command(): string[] | null {
    if (this.options.command) return this.options.command;
    const exe = findExecutable(this.spec.executable);
    return exe ? [exe, ...this.spec.args] : null;
  }

  async discover(): Promise<AgentProviderInfo> {
    const unknown: AgentCapabilities = {
      resume: false,
      history: false,
      rename: false,
      interrupt: false,
      followUp: "none",
      approvals: ["deny"],
      turnDiff: false,
    };
    const base = { id: this.id, label: this.label };
    const command = this.command();
    if (!command)
      return {
        ...base,
        status: "not-installed",
        message: this.spec.install,
        capabilities: unknown,
      };
    try {
      const init = await handshake(command, process.cwd());
      if (init.protocolVersion !== ACP_VERSION) {
        return {
          ...base,
          status: "incompatible",
          message: `${this.label} speaks Agent Client Protocol ${String(init.protocolVersion)}; Velloo speaks ${ACP_VERSION}.`,
          capabilities: unknown,
        };
      }
      const found = advertised(init);
      return {
        ...base,
        status: "ready",
        ...(found.version ? { version: found.version } : {}),
        capabilities: found.capabilities,
      };
    } catch (error) {
      return {
        ...base,
        status: "incompatible",
        message: `${this.label} didn't answer as an Agent Client Protocol agent: ${error instanceof Error ? error.message : String(error)}`,
        capabilities: unknown,
      };
    }
  }

  async start(launch: AgentLaunch, sink: AgentSink): Promise<AgentConnection> {
    const command = this.command();
    if (!command)
      throw new AgentError("unavailable", `${this.label} isn't installed. ${this.spec.install}`);
    const session = new AcpSession(command, launch, sink, this.spec);
    await session.open();
    return session;
  }
}

/** Start the agent, shake hands, and stop it: what it advertises, nothing more. */
async function handshake(command: string[], cwd: string): Promise<Record<string, unknown>> {
  let rpc: JsonRpc | undefined;
  const proc = new JsonLineProcess(command, cwd, {
    message: (value) => {
      const incoming = rpc?.handle(value);
      if (incoming?.kind === "request")
        rpc?.respondError(incoming.id, -32601, "Not supported by Velloo.");
    },
    malformed: () => undefined,
    exit: (code, stderr) =>
      rpc?.failAll(new Error(stderr.split("\n").at(-1) || `exited with code ${code}`)),
  });
  rpc = new JsonRpc((value) => proc.write(value));
  try {
    return asRecord(
      await rpc.request(
        "initialize",
        { protocolVersion: ACP_VERSION, clientCapabilities: CLIENT_CAPABILITIES },
        30_000,
      ),
    );
  } finally {
    await proc.close();
  }
}

interface Permission {
  rpcId: RpcId;
  optionFor: Partial<Record<AgentApprovalDecision, string>>;
}

class AcpSession implements AgentConnection {
  private rpc!: JsonRpc;
  private proc!: JsonLineProcess;
  private sessionId = "";
  private found!: Advertised;
  private turnId: string | null = null;
  private interrupting = false;
  private closing = false;
  private instructed = false;
  private warnedMalformed = false;
  private readonly permissions = new Map<string, Permission>();
  private readonly tools = new Map<string, Record<string, unknown>>();
  /** The text item an agent's streamed reply is filling, keyed by kind. */
  private streaming: { text?: string; thought?: string } = {};
  private seq = 0;
  /** Whether the running turn has shown anything yet. */
  private answered = false;
  /** Turns a reopened session replays before `session/load` answers. */
  private replay: AgentTurn[] | null = null;

  constructor(
    private readonly command: string[],
    private readonly launch: AgentLaunch,
    private readonly sink: AgentSink,
    private readonly spec: AcpAgentSpec,
  ) {}

  async open(): Promise<void> {
    this.proc = new JsonLineProcess(this.command, this.launch.cwd, {
      message: (value) => this.onMessage(value),
      malformed: () => {
        if (this.warnedMalformed) return;
        this.warnedMalformed = true;
        this.sink.notice(
          "warning",
          `${this.spec.label} sent a line Velloo couldn't read; it was skipped.`,
        );
      },
      exit: (code, stderr) => {
        const reason = this.closing
          ? undefined
          : stderr.split("\n").filter(Boolean).at(-1) ||
            `${this.spec.label} exited with code ${code ?? "unknown"}.`;
        this.rpc.failAll(new AgentError("unavailable", reason ?? `${this.spec.label} stopped.`));
        this.sink.exited(reason);
      },
    });
    this.rpc = new JsonRpc((value) => this.proc.write(value));
    try {
      const init = asRecord(
        await this.rpc.request(
          "initialize",
          { protocolVersion: ACP_VERSION, clientCapabilities: CLIENT_CAPABILITIES },
          30_000,
        ),
      );
      this.found = advertised(init);
      const mcpServers = this.mcpServers();
      const resume = this.launch.resume;
      if (resume && this.found.loadSession) {
        this.replay = [];
        await this.rpc.request(
          "session/load",
          { sessionId: resume, cwd: this.launch.cwd, mcpServers },
          120_000,
        );
        this.sessionId = resume;
        this.instructed = true;
      } else {
        const created = asRecord(
          await this.rpc.request("session/new", { cwd: this.launch.cwd, mcpServers }, 60_000),
        );
        if (typeof created.sessionId !== "string")
          throw new AgentError("unavailable", `${this.spec.label} didn't start a session.`);
        this.sessionId = created.sessionId;
      }
      this.sink.ready({
        providerSessionId: this.sessionId,
        environment: {
          execution: "local",
          host: hostname(),
          cwd: this.launch.cwd,
          sandbox: `${this.spec.label}'s own permissions`,
          approvalMode: "asks by its own rules",
          ...(this.found.version ? { providerVersion: this.found.version } : {}),
        },
        resumable: this.found.loadSession,
      });
      if (this.replay) {
        this.sink.history(this.replay);
        this.replay = null;
      }
    } catch (error) {
      await this.close();
      if (error instanceof RpcError && error.code === AUTH_REQUIRED) {
        throw new AgentError(
          "unavailable",
          `${this.spec.label} isn't signed in. ${this.spec.signIn}`,
        );
      }
      if (error instanceof AgentError) throw error;
      throw new AgentError(
        "unavailable",
        `${this.spec.label} couldn't start: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** Velloo's MCP server in whichever transport the agent takes. */
  private mcpServers(): unknown[] {
    const mcp = this.launch.mcp;
    if (!mcp) return [];
    if (this.found.mcpHttp) return [{ type: "http", name: mcp.name, url: mcp.url, headers: [] }];
    if (mcp.command) {
      const [command, ...args] = mcp.command;
      return [{ name: mcp.name, command, args, env: [] }];
    }
    return [];
  }

  async startTurn(text: string): Promise<string> {
    const turnId = `turn-${crypto.randomUUID()}`;
    this.turnId = turnId;
    this.interrupting = false;
    this.answered = false;
    this.streaming = {};
    this.sink.turnStarted(turnId);
    // ACP has no system prompt: the canvas instructions lead the first prompt.
    const prompt = [
      ...(this.instructed ? [] : [{ type: "text", text: this.launch.instructions }]),
      { type: "text", text },
    ];
    this.instructed = true;
    void this.rpc
      .request("session/prompt", { sessionId: this.sessionId, prompt }, 24 * 60 * 60_000)
      .then(
        (result) => this.finish(turnId, asRecord(result).stopReason),
        (error: unknown) => this.finish(turnId, "error", error),
      );
    return turnId;
  }

  async interrupt(): Promise<void> {
    if (!this.turnId) return;
    this.interrupting = true;
    this.cancelPermissions();
    this.rpc.notify("session/cancel", { sessionId: this.sessionId });
  }

  async answer(approvalId: string, decision: AgentApprovalDecision): Promise<void> {
    const permission = this.permissions.get(approvalId);
    if (!permission) throw new AgentError("not-found", "That request is no longer waiting.");
    this.permissions.delete(approvalId);
    const optionId = permission.optionFor[decision];
    this.rpc.respond(
      permission.rpcId,
      optionId
        ? { outcome: { outcome: "selected", optionId } }
        : { outcome: { outcome: "cancelled" } },
    );
    if (decision === "abort") await this.interrupt();
  }

  async close(): Promise<void> {
    this.closing = true;
    await this.proc?.close();
  }

  private cancelPermissions(): void {
    // The protocol asks a client that cancels to answer what's still waiting.
    for (const [approvalId, permission] of this.permissions) {
      this.rpc.respond(permission.rpcId, { outcome: { outcome: "cancelled" } });
      this.permissions.delete(approvalId);
      this.sink.approvalWithdrawn(approvalId);
    }
  }

  private finish(turnId: string, stopReason: unknown, error?: unknown): void {
    if (this.turnId !== turnId) return;
    this.turnId = null;
    this.cancelPermissions();
    for (const [id, raw] of this.tools) {
      if (raw.status !== "completed" && raw.status !== "failed") {
        const item = toolCallItem(
          { ...raw, status: "failed" },
          this.launch.cwd,
          this.launch.mcp?.name,
        );
        if (item) this.sink.item(turnId, item);
      }
      this.tools.delete(id);
    }
    if (this.interrupting || stopReason === "cancelled") {
      this.interrupting = false;
      this.sink.turnCompleted(turnId, "interrupted");
      return;
    }
    if (error !== undefined) {
      const message =
        error instanceof RpcError && error.code === AUTH_REQUIRED
          ? `${this.spec.label} isn't signed in. ${this.spec.signIn}`
          : error instanceof Error
            ? error.message
            : String(error);
      this.sink.turnCompleted(turnId, "failed", message);
      return;
    }
    if (stopReason === "refusal") {
      this.sink.turnCompleted(turnId, "failed", `${this.spec.label} declined to answer.`);
      return;
    }
    if (!this.answered) {
      // An agent whose model is unreachable can end the turn as if it had
      // answered; an empty "done" would hide that.
      this.sink.notice(
        "warning",
        `${this.spec.label} finished without replying. Check its model and sign-in in a terminal.`,
      );
    }
    if (stopReason === "max_tokens" || stopReason === "max_turn_requests") {
      this.sink.notice(
        "warning",
        `${this.spec.label} stopped at its limit (${String(stopReason)}).`,
      );
    }
    this.sink.turnCompleted(turnId, "completed");
  }

  private onMessage(value: unknown): void {
    const incoming = this.rpc.handle(value);
    if (!incoming || incoming.kind === "response") return;
    if (incoming.kind === "request") {
      if (incoming.method === "session/request_permission")
        this.onPermission(incoming.id, incoming.params);
      // File system and terminal requests: Velloo advertised neither.
      else this.rpc.respondError(incoming.id, -32601, `Velloo doesn't handle ${incoming.method}.`);
      return;
    }
    if (incoming.method === "session/update" && incoming.params.sessionId === this.sessionId) {
      this.onUpdate(asRecord(incoming.params.update));
    } else if (incoming.method === "session/update" && this.replay) {
      // A reopened session's updates arrive before its id is confirmed.
      this.onUpdate(asRecord(incoming.params.update));
    }
  }

  private onPermission(rpcId: RpcId, p: Record<string, unknown>): void {
    const call = asRecord(p.toolCall);
    const { decisions, optionFor } = permissionDecisions(p.options);
    const approvalId = `acp-${String(rpcId)}`;
    this.permissions.set(approvalId, { rpcId, optionFor });
    const toolCallId = typeof call.toolCallId === "string" ? call.toolCallId : undefined;
    const known = toolCallId ? this.tools.get(toolCallId) : undefined;
    const merged = { ...known, ...call };
    const item = toolCallItem({ toolCallId: toolCallId ?? approvalId, ...merged }, this.launch.cwd);
    const title = typeof merged.title === "string" && merged.title ? merged.title : "Use a tool";
    const input = item?.kind === "tool" ? item.input : summarize(merged.rawInput);
    this.sink.approval({
      id: approvalId,
      ...(this.turnId ? { turnId: this.turnId } : {}),
      ...(toolCallId ? { itemId: toolCallId } : {}),
      kind:
        item?.kind === "command"
          ? "command"
          : item?.kind === "file-change"
            ? "file-change"
            : "tool",
      title,
      ...(item?.kind === "command" ? { command: item.command } : {}),
      ...(item?.kind === "file-change" ? { paths: item.changes.map((c) => c.path) } : {}),
      ...(input && item?.kind !== "command" ? { input } : {}),
      cwd: this.launch.cwd,
      decisions,
      requestedAt: new Date().toISOString(),
    });
  }

  private onUpdate(update: Record<string, unknown>): void {
    const kind = update.sessionUpdate;
    if (this.replay) {
      this.onReplay(update);
      return;
    }
    const turnId = this.turnId;
    if (!turnId) return;
    if (kind === "agent_message_chunk" || kind === "tool_call" || kind === "plan")
      this.answered = true;
    switch (kind) {
      case "agent_message_chunk":
      case "agent_thought_chunk": {
        const text = contentText([asRecord(update.content)]);
        if (!text) return;
        const slot = kind === "agent_message_chunk" ? "text" : "thought";
        let id = this.streaming[slot];
        if (!id) {
          id = `${slot}-${turnId}-${this.seq++}`;
          this.streaming[slot] = id;
          this.sink.item(
            turnId,
            slot === "text"
              ? { kind: "agent-text", id, text: "" }
              : { kind: "reasoning", id, text: "" },
          );
        }
        this.sink.delta(turnId, id, "text", text);
        return;
      }
      case "tool_call":
      case "tool_call_update": {
        const toolCallId = update.toolCallId;
        if (typeof toolCallId !== "string") return;
        // Text after a tool call is a new message, not more of the last one.
        this.streaming = {};
        const merged = { ...this.tools.get(toolCallId), ...update };
        this.tools.set(toolCallId, merged);
        const item = toolCallItem(merged, this.launch.cwd, this.launch.mcp?.name);
        if (item) this.sink.item(turnId, item);
        return;
      }
      case "plan": {
        const entries = Array.isArray(update.entries) ? update.entries.map(asRecord) : [];
        this.sink.item(turnId, {
          kind: "plan",
          id: `plan-${turnId}`,
          steps: entries.map((e) => ({
            text: String(e.content ?? ""),
            status:
              e.status === "completed"
                ? "completed"
                : e.status === "in_progress"
                  ? "in-progress"
                  : "pending",
          })),
        });
        return;
      }
      default:
        return;
    }
  }

  /** Rebuild a reopened session's earlier turns from what the agent replays. */
  private onReplay(update: Record<string, unknown>): void {
    const replay = this.replay;
    if (!replay) return;
    const kind = update.sessionUpdate;
    const text = contentText([asRecord(update.content)]);
    if (kind === "user_message_chunk") {
      const last = replay.at(-1);
      const userItem = last?.items.at(-1);
      if (last && last.items.length === 1 && userItem?.kind === "user") {
        last.items[0] = { ...userItem, text: userItem.text + text };
        return;
      }
      const now = new Date().toISOString();
      replay.push({
        id: `replay-${replay.length}`,
        status: "completed",
        startedAt: now,
        completedAt: now,
        items: [{ kind: "user", id: `replay-${replay.length}-u`, text }],
      });
      return;
    }
    const turn = replay.at(-1);
    if (!turn) return;
    if (kind === "agent_message_chunk" && text) {
      const last = turn.items.at(-1);
      if (last?.kind === "agent-text")
        turn.items[turn.items.length - 1] = { ...last, text: last.text + text };
      else turn.items.push({ kind: "agent-text", id: `${turn.id}-${turn.items.length}`, text });
    } else if (kind === "tool_call" || kind === "tool_call_update") {
      const item: AgentItem | null = toolCallItem(update, this.launch.cwd, this.launch.mcp?.name);
      if (!item) return;
      const index = turn.items.findIndex((i) => i.id === item.id);
      if (index >= 0) turn.items[index] = item;
      else turn.items.push(item);
    }
  }
}
