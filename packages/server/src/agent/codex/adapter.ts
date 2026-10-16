import { mkdtemp, readFile, rm } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import type {
  AgentApprovalDecision,
  AgentApprovalRequest,
  AgentCapabilities,
  AgentHistoryEntry,
  AgentProviderInfo,
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
import { JsonRpc, type RpcId } from "../json-rpc.ts";
import { findExecutable, JsonLineProcess, parseVersion, runOnce } from "../process.ts";
import {
  approvalLabel,
  displayCommand,
  fileChanges,
  normalizeItem,
  normalizeTurns,
  sandboxLabel,
  turnStatus,
} from "./normalize.ts";

const LABEL = "Codex";
const INSTALL =
  "Install Codex (`npm install -g @openai/codex` or `brew install codex`), then check again.";
const UPGRADE =
  "Upgrade Codex (`npm install -g @openai/codex@latest` or `brew upgrade codex`), then check again.";

/** Methods Velloo can't run a session without. */
const REQUIRED_CLIENT = [
  "initialize",
  "account/read",
  "thread/start",
  "thread/resume",
  "turn/start",
  "turn/interrupt",
];
const REQUIRED_SERVER = [
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
];

/** The person's policy, when their config sets none: Codex's own interactive default. */
const DEFAULT_APPROVAL = "on-request";
const DEFAULT_SANDBOX = "workspace-write";

interface Protocol {
  client: Set<string>;
  server: Set<string>;
}

function methodsIn(schema: unknown): string[] {
  const variants = asRecord(schema).oneOf ?? asRecord(schema).anyOf;
  if (!Array.isArray(variants)) return [];
  return variants.flatMap((v) => {
    const method = asRecord(asRecord(asRecord(v).properties).method);
    return Array.isArray(method.enum)
      ? method.enum.filter((m): m is string => typeof m === "string")
      : [];
  });
}

function capabilitiesFor(protocol: Protocol): AgentCapabilities {
  return {
    resume: true,
    history: protocol.client.has("thread/list"),
    rename: protocol.client.has("thread/name/set"),
    interrupt: true,
    followUp: protocol.client.has("turn/steer") ? "steer" : "queue",
    approvals: ["allow-once", "allow-session", "deny", "abort"],
    turnDiff: true,
  };
}

const PLAN_LABELS: Record<string, string> = {
  free: "ChatGPT Free",
  go: "ChatGPT Go",
  plus: "ChatGPT Plus",
  pro: "ChatGPT Pro",
  team: "ChatGPT Team",
  business: "ChatGPT Business",
  enterprise: "ChatGPT Enterprise",
  edu: "ChatGPT Edu",
};

function accountLabel(raw: unknown): string | undefined {
  const account = asRecord(raw);
  if (account.type === "apiKey") return "API key";
  if (account.type === "amazonBedrock") return "Amazon Bedrock";
  if (account.type === "chatgpt") {
    const plan = typeof account.planType === "string" ? account.planType : "";
    return PLAN_LABELS[plan] ?? "ChatGPT";
  }
  return undefined;
}

export interface CodexAdapterOptions {
  /** The command that runs Codex, for tests; found on PATH otherwise. */
  command?: string[];
}

/**
 * Codex through its app-server: JSON-RPC over the child's stdio, the protocol
 * Codex's own editor integrations use. Velloo stays the only transport to the
 * browser — Codex's direct WebSocket listener is never enabled.
 *
 * Capabilities come from the installed Codex's own schema
 * (`codex app-server generate-json-schema`), so a version that lacks a method
 * degrades to a capability flag instead of a runtime failure.
 */
export class CodexAdapter implements AgentAdapter {
  readonly id = "codex";
  readonly label = LABEL;
  private readonly protocols = new Map<string, Promise<Protocol | null>>();

  constructor(private readonly options: CodexAdapterOptions = {}) {}

  private command(): string[] | null {
    if (this.options.command) return this.options.command;
    const exe = findExecutable("codex");
    return exe ? [exe] : null;
  }

  async discover(): Promise<AgentProviderInfo> {
    const base = { id: this.id, label: LABEL };
    const unknown: AgentCapabilities = {
      resume: false,
      history: false,
      rename: false,
      interrupt: false,
      followUp: "none",
      approvals: ["deny"],
      turnDiff: false,
    };
    const command = this.command();
    if (!command)
      return {
        ...base,
        status: "not-installed",
        message: `Codex isn't installed. ${INSTALL}`,
        capabilities: unknown,
      };
    const version = parseVersion(await runOnce([...command, "--version"]));
    if (!version) {
      return {
        ...base,
        status: "error",
        message: "`codex --version` didn't answer. Check that Codex runs in a terminal.",
        capabilities: unknown,
      };
    }
    const protocol = await this.protocol(command, version);
    const missing = protocol
      ? [
          ...REQUIRED_CLIENT.filter((m) => !protocol.client.has(m)),
          ...REQUIRED_SERVER.filter((m) => !protocol.server.has(m)),
        ]
      : REQUIRED_CLIENT;
    if (!protocol || missing.length > 0) {
      return {
        ...base,
        status: "incompatible",
        version,
        message: protocol
          ? `Codex ${version} doesn't support ${missing.join(", ")}. ${UPGRADE}`
          : `Codex ${version} has no app-server protocol Velloo can read. ${UPGRADE}`,
        capabilities: unknown,
      };
    }
    const capabilities = capabilitiesFor(protocol);
    const account = await this.account(command, version);
    if (account.error)
      return { ...base, status: "error", version, message: account.error, capabilities };
    if (account.signedOut) {
      return {
        ...base,
        status: "logged-out",
        version,
        message: "Codex isn't signed in. Run `codex login` in a terminal, then check again.",
        capabilities,
      };
    }
    return {
      ...base,
      status: "ready",
      version,
      ...(account.label ? { account: account.label } : {}),
      capabilities,
    };
  }

  async start(launch: AgentLaunch, sink: AgentSink): Promise<AgentConnection> {
    const command = this.command();
    if (!command) throw new AgentError("unavailable", `Codex isn't installed. ${INSTALL}`);
    const version = parseVersion(await runOnce([...command, "--version"])) ?? undefined;
    const protocol = version ? await this.protocol(command, version) : null;
    if (!protocol)
      throw new AgentError("unavailable", `This Codex can't run in Velloo. ${UPGRADE}`);
    const session = new CodexSession(command, launch, sink, protocol, version);
    await session.open();
    return session;
  }

  async history(cwd: string): Promise<AgentHistoryEntry[]> {
    const command = this.command();
    if (!command) return [];
    return withAppServer(command, cwd, async (rpc) => {
      const result = asRecord(
        await rpc.request("thread/list", { cwd, limit: 30, sortKey: "updated_at" }),
      );
      const data = Array.isArray(result.data) ? result.data : [];
      return data.flatMap((raw) => {
        const thread = asRecord(raw);
        if (typeof thread.id !== "string") return [];
        const title =
          typeof thread.name === "string" && thread.name
            ? thread.name
            : String(thread.preview ?? "");
        const updated = typeof thread.updatedAt === "number" ? thread.updatedAt * 1000 : Date.now();
        return [
          {
            providerSessionId: thread.id,
            title: title.split("\n")[0]?.slice(0, 120) || "Untitled",
            updatedAt: new Date(updated).toISOString(),
          },
        ];
      });
    }).catch(() => []);
  }

  /** The methods this Codex version speaks, read once per version from its own schema. */
  private protocol(command: string[], version: string): Promise<Protocol | null> {
    const key = `${command.join(" ")}@${version}`;
    let cached = this.protocols.get(key);
    if (!cached) {
      cached = readProtocol(command);
      this.protocols.set(key, cached);
    }
    return cached;
  }

  private async account(
    command: string[],
    version: string,
  ): Promise<{ label?: string; signedOut?: boolean; error?: string }> {
    try {
      return await withAppServer(
        command,
        tmpdir(),
        async (rpc) => {
          const result = asRecord(await rpc.request("account/read", {}, 15_000));
          if (!result.account && result.requiresOpenaiAuth) return { signedOut: true };
          const label = accountLabel(result.account);
          return label ? { label } : {};
        },
        version,
      );
    } catch (error) {
      return {
        error: `Codex's app-server didn't start: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}

async function readProtocol(command: string[]): Promise<Protocol | null> {
  const dir = await mkdtemp(join(tmpdir(), "velloo-codex-schema-"));
  try {
    const out = await runOnce(
      [...command, "app-server", "generate-json-schema", "--out", dir],
      undefined,
      20_000,
    );
    if (out === null) return null;
    const read = async (name: string) => {
      try {
        return methodsIn(JSON.parse(await readFile(join(dir, name), "utf8")));
      } catch {
        return [];
      }
    };
    const [client, server] = await Promise.all([
      read("ClientRequest.json"),
      read("ServerRequest.json"),
    ]);
    return client.length ? { client: new Set(client), server: new Set(server) } : null;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Run a short exchange with a throwaway app-server. */
async function withAppServer<T>(
  command: string[],
  cwd: string,
  run: (rpc: JsonRpc) => Promise<T>,
  version = "0.0.0",
): Promise<T> {
  let rpc: JsonRpc | undefined;
  let exitError: string | undefined;
  const proc = new JsonLineProcess([...command, "app-server"], cwd, {
    message: (value) => {
      const incoming = rpc?.handle(value);
      if (incoming?.kind === "request")
        rpc?.respondError(incoming.id, -32601, "Not supported by Velloo.");
    },
    malformed: () => undefined,
    exit: (code, stderr) => {
      exitError = stderr.split("\n").at(-1) || `exited with code ${code}`;
      rpc?.failAll(new Error(exitError));
    },
  });
  rpc = new JsonRpc((value) => proc.write(value));
  try {
    await initialize(rpc, version);
    return await run(rpc);
  } finally {
    await proc.close();
  }
}

async function initialize(rpc: JsonRpc, version: string): Promise<void> {
  await rpc.request(
    "initialize",
    { clientInfo: { name: "velloo", title: "Velloo", version }, capabilities: null },
    20_000,
  );
  rpc.notify("initialized");
}

interface PendingApproval {
  rpcId: RpcId;
  method: string;
  params: Record<string, unknown>;
}

const APPROVAL_DECISION: Record<AgentApprovalDecision, string> = {
  "allow-once": "accept",
  "allow-session": "acceptForSession",
  deny: "decline",
  abort: "cancel",
};
const LEGACY_DECISION: Record<AgentApprovalDecision, string> = {
  "allow-once": "approved",
  "allow-session": "approved_for_session",
  deny: "denied",
  abort: "abort",
};

class CodexSession implements AgentConnection {
  private readonly rpc: JsonRpc;
  private readonly proc: JsonLineProcess;
  private threadId = "";
  private readonly approvals = new Map<string, PendingApproval>();
  /** Files each file-change item touches, for naming them in its approval. */
  private readonly itemPaths = new Map<string, string[]>();
  private closing = false;
  private warnedMalformed = false;

  constructor(
    command: string[],
    private readonly launch: AgentLaunch,
    private readonly sink: AgentSink,
    private readonly protocol: Protocol,
    private readonly version: string | undefined,
  ) {
    this.proc = new JsonLineProcess([...command, "app-server"], launch.cwd, {
      message: (value) => this.onMessage(value),
      malformed: () => {
        if (this.warnedMalformed) return;
        this.warnedMalformed = true;
        this.sink.notice("warning", "Codex sent a message Velloo couldn't read; it was skipped.");
      },
      exit: (code, stderr) => {
        const reason = this.closing
          ? undefined
          : stderr.split("\n").filter(Boolean).at(-1) ||
            `Codex exited with code ${code ?? "unknown"}.`;
        this.rpc.failAll(new AgentError("unavailable", reason ?? "Codex stopped."));
        this.sink.exited(reason);
      },
    });
    this.rpc = new JsonRpc((value) => this.proc.write(value));
  }

  async open(): Promise<void> {
    try {
      await initialize(this.rpc, this.version ?? "0.0.0");
      const config = this.protocol.client.has("config/read")
        ? asRecord(
            asRecord(
              await this.rpc.request("config/read", { cwd: this.launch.cwd }).catch(() => ({})),
            ).config,
          )
        : {};
      const params = {
        cwd: this.launch.cwd,
        approvalPolicy: config.approval_policy ?? DEFAULT_APPROVAL,
        sandbox: config.sandbox_mode ?? DEFAULT_SANDBOX,
        developerInstructions: this.launch.instructions,
        ...(this.launch.mcp ? { config: mcpOverride(this.launch.mcp, config) } : {}),
      };
      const resumed = this.launch.resume;
      const result = asRecord(
        resumed
          ? await this.rpc.request("thread/resume", { threadId: resumed, ...params })
          : await this.rpc.request("thread/start", { ...params, ephemeral: false }),
      );
      const thread = asRecord(result.thread);
      if (typeof thread.id !== "string")
        throw new AgentError("unavailable", "Codex didn't start a thread.");
      this.threadId = thread.id;
      const model = typeof result.model === "string" ? result.model : undefined;
      const version = this.version;
      this.sink.ready({
        providerSessionId: thread.id,
        environment: {
          execution: "local",
          host: hostname(),
          cwd: typeof result.cwd === "string" ? result.cwd : this.launch.cwd,
          sandbox: sandboxLabel(result.sandbox),
          approvalMode: approvalLabel(result.approvalPolicy),
          ...(model ? { model } : {}),
          ...(version ? { providerVersion: version } : {}),
        },
        ...(typeof thread.name === "string" && thread.name ? { title: thread.name } : {}),
        resumable: thread.ephemeral !== true,
        terminalCommand: ["codex", "resume", thread.id],
      });
      if (resumed) this.sink.history(normalizeTurns(thread.turns));
    } catch (error) {
      await this.close();
      if (error instanceof AgentError) throw error;
      throw new AgentError(
        "unavailable",
        `Codex couldn't start: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async startTurn(text: string): Promise<string> {
    const result = asRecord(
      await this.rpc.request("turn/start", { threadId: this.threadId, input: [textInput(text)] }),
    );
    const id = asRecord(result.turn).id;
    if (typeof id !== "string") throw new AgentError("unavailable", "Codex didn't start a turn.");
    return id;
  }

  async steer(turnId: string, text: string): Promise<void> {
    await this.rpc.request("turn/steer", {
      threadId: this.threadId,
      input: [textInput(text)],
      expectedTurnId: turnId,
    });
  }

  async interrupt(turnId: string): Promise<void> {
    await this.rpc.request("turn/interrupt", { threadId: this.threadId, turnId });
  }

  async rename(title: string): Promise<void> {
    if (!this.protocol.client.has("thread/name/set")) return;
    await this.rpc.request("thread/name/set", { threadId: this.threadId, name: title });
  }

  async answer(approvalId: string, decision: AgentApprovalDecision): Promise<void> {
    const pending = this.approvals.get(approvalId);
    if (!pending) throw new AgentError("not-found", "That request is no longer waiting.");
    this.approvals.delete(approvalId);
    this.rpc.respond(pending.rpcId, approvalResponse(pending, decision));
  }

  async close(): Promise<void> {
    this.closing = true;
    await this.proc.close();
  }

  private onMessage(value: unknown): void {
    const incoming = this.rpc.handle(value);
    if (!incoming || incoming.kind === "response") return;
    if (incoming.kind === "request") this.onRequest(incoming.id, incoming.method, incoming.params);
    else this.onNotification(incoming.method, incoming.params);
  }

  private ours(params: Record<string, unknown>): boolean {
    return (
      params.threadId === undefined || params.threadId === null || params.threadId === this.threadId
    );
  }

  private onNotification(method: string, p: Record<string, unknown>): void {
    if (!this.ours(p)) return;
    const turnId = typeof p.turnId === "string" ? p.turnId : "";
    switch (method) {
      case "turn/started": {
        const id = asRecord(p.turn).id;
        if (typeof id === "string") this.sink.turnStarted(id);
        return;
      }
      case "turn/completed": {
        const turn = asRecord(p.turn);
        if (typeof turn.id !== "string") return;
        const status = turnStatus(turn.status);
        const message = asRecord(turn.error).message;
        this.sink.turnCompleted(
          turn.id,
          status === "running" ? "completed" : status,
          typeof message === "string" ? message : undefined,
        );
        return;
      }
      case "item/started":
      case "item/completed": {
        const raw = asRecord(p.item);
        if (raw.type === "fileChange" && typeof raw.id === "string") {
          this.itemPaths.set(
            raw.id,
            fileChanges(raw.changes).map((c) => c.path),
          );
        }
        const item = normalizeItem(raw);
        if (item && turnId) this.sink.item(turnId, item);
        return;
      }
      case "item/agentMessage/delta":
      case "item/reasoning/summaryTextDelta":
      case "item/plan/delta":
        if (typeof p.itemId === "string" && typeof p.delta === "string") {
          this.sink.delta(turnId, p.itemId, "text", p.delta);
        }
        return;
      case "item/commandExecution/outputDelta":
        if (typeof p.itemId === "string" && typeof p.delta === "string") {
          this.sink.delta(turnId, p.itemId, "output", p.delta);
        }
        return;
      case "turn/diff/updated":
        if (typeof p.diff === "string") this.sink.turnDiff(turnId, p.diff);
        return;
      case "turn/plan/updated": {
        const plan = Array.isArray(p.plan) ? p.plan : [];
        this.sink.item(turnId, {
          kind: "plan",
          id: `plan-${turnId}`,
          steps: plan.map((raw) => {
            const step = asRecord(raw);
            return {
              text: String(step.step ?? ""),
              status:
                step.status === "completed"
                  ? "completed"
                  : step.status === "inProgress"
                    ? "in-progress"
                    : "pending",
            };
          }),
        });
        return;
      }
      case "thread/name/updated":
        if (typeof p.threadName === "string" && p.threadName) this.sink.titled(p.threadName);
        return;
      case "serverRequest/resolved": {
        for (const [approvalId, pending] of this.approvals) {
          if (pending.rpcId === p.requestId) {
            this.approvals.delete(approvalId);
            this.sink.approvalWithdrawn(approvalId);
          }
        }
        return;
      }
      case "error": {
        const message = asRecord(p.error).message;
        if (typeof message !== "string") return;
        this.sink.notice(
          p.willRetry ? "warning" : "error",
          p.willRetry ? `${message} Retrying…` : message,
        );
        return;
      }
      case "mcpServer/startupStatus/updated":
        if (p.name === this.launch.mcp?.name && p.status === "failed") {
          this.sink.notice(
            "error",
            `The Velloo MCP server didn't start in Codex${typeof p.error === "string" ? `: ${p.error}` : "."} Design edits won't reach the canvas.`,
          );
        }
        return;
      case "warning":
      case "configWarning":
      case "deprecationNotice":
        if (typeof p.message === "string") this.sink.notice("warning", p.message);
        return;
      case "thread/status/changed":
        if (asRecord(p.status).type === "systemError") {
          this.sink.notice("error", "Codex hit an internal error on this thread.");
        }
        return;
      default:
        return;
    }
  }

  private onRequest(id: RpcId, method: string, p: Record<string, unknown>): void {
    const request = approvalRequest(method, p, this.itemPaths, this.launch.cwd);
    if (!request) {
      // Nothing Velloo registered asks for these (dynamic tools, external auth,
      // attestation); refusing is the safe answer and Codex reports it.
      this.rpc.respondError(id, -32601, `Velloo doesn't handle ${method}.`);
      return;
    }
    const approvalId = `codex-${String(id)}`;
    this.approvals.set(approvalId, { rpcId: id, method, params: p });
    this.sink.approval({ ...request, id: approvalId });
  }
}

function textInput(text: string) {
  return { type: "text", text, text_elements: [] };
}

/**
 * Point this session's `velloo` server at the open design. Codex merges a
 * config override into the person's own entry, so the override must keep that
 * entry's transport: a stdio entry gets a command for this design, an HTTP
 * entry this daemon's URL. Their other settings for it (tool approvals) stay.
 */
function mcpOverride(mcp: NonNullable<AgentLaunch["mcp"]>, config: Record<string, unknown>) {
  const existing = asRecord(asRecord(config.mcp_servers)[mcp.name]);
  const useUrl = typeof existing.url === "string" || !mcp.command;
  const [exe, ...args] = mcp.command ?? [];
  return {
    [`mcp_servers.${mcp.name}`]: useUrl
      ? { url: mcp.url, enabled: true }
      : { command: exe, args, enabled: true },
  };
}

function approvalRequest(
  method: string,
  p: Record<string, unknown>,
  itemPaths: Map<string, string[]>,
  cwd: string,
): Omit<AgentApprovalRequest, "id"> | null {
  const base = {
    ...(typeof p.turnId === "string" ? { turnId: p.turnId } : {}),
    ...(typeof p.itemId === "string" ? { itemId: p.itemId } : {}),
    ...(typeof p.reason === "string" && p.reason ? { reason: p.reason } : {}),
    requestedAt: new Date().toISOString(),
  };
  const all: AgentApprovalDecision[] = ["allow-once", "allow-session", "deny", "abort"];
  switch (method) {
    case "item/commandExecution/requestApproval":
    case "execCommandApproval": {
      const raw = Array.isArray(p.command) ? p.command.join(" ") : String(p.command ?? "");
      return {
        ...base,
        kind: "command",
        title: p.kind === "writeStdin" ? "Send input to a running command" : "Run a command",
        command: displayCommand(raw),
        cwd: typeof p.cwd === "string" ? p.cwd : cwd,
        decisions: all,
      };
    }
    case "item/fileChange/requestApproval":
    case "applyPatchApproval": {
      const paths =
        (typeof p.itemId === "string" ? itemPaths.get(p.itemId) : undefined) ??
        Object.keys(asRecord(p.fileChanges));
      return {
        ...base,
        kind: "file-change",
        title:
          typeof p.grantRoot === "string" ? `Allow writes under ${p.grantRoot}` : "Change files",
        ...(paths.length ? { paths } : {}),
        cwd,
        decisions: all,
      };
    }
    case "item/permissions/requestApproval": {
      const input = summarize(p.permissions);
      return {
        ...base,
        kind: "permissions",
        title: "Grant more access",
        ...(input ? { input } : {}),
        cwd: typeof p.cwd === "string" ? p.cwd : cwd,
        decisions: ["allow-once", "allow-session", "deny"],
      };
    }
    case "item/tool/requestUserInput": {
      const questions = Array.isArray(p.questions) ? p.questions.map(asRecord) : [];
      const text = questions.map((q) => String(q.question ?? q.header ?? "")).filter(Boolean);
      return {
        ...base,
        kind: "question",
        title: text[0] ?? "Codex has a question",
        ...(text.length > 1 ? { input: text.slice(1).join("\n") } : {}),
        reason: "Answer it in your next message — Velloo can only skip this prompt.",
        decisions: ["deny"],
      };
    }
    case "mcpServer/elicitation/request": {
      const answer = confirmationAnswer(p);
      return {
        ...base,
        kind: "tool",
        title: typeof p.message === "string" ? p.message : "An MCP server is asking for input",
        ...(typeof p.serverName === "string"
          ? { tool: p.serverName, reason: `Asked by the ${p.serverName} MCP server.` }
          : {}),
        ...(typeof p.url === "string" ? { input: p.url } : {}),
        // A yes/no question can be answered here; a form asking for values
        // can't, and is only declined.
        decisions: answer ? ["allow-once", "deny", "abort"] : ["deny", "abort"],
      };
    }
    default:
      return null;
  }
}

/**
 * The content that says "yes" to an elicitation that is only a confirmation —
 * a form with nothing to fill, or whose required fields are all yes/no. Null
 * for anything that asks for values, which Velloo has no form to collect.
 */
function confirmationAnswer(p: Record<string, unknown>): Record<string, boolean> | null {
  if (p.mode === "url") return null;
  const schema = asRecord(p.requestedSchema);
  const properties = asRecord(schema.properties);
  const required = Array.isArray(schema.required)
    ? schema.required.filter((r) => typeof r === "string")
    : [];
  const answer: Record<string, boolean> = {};
  for (const name of required) {
    if (asRecord(properties[name]).type !== "boolean") return null;
    answer[name] = true;
  }
  return answer;
}

function approvalResponse(pending: PendingApproval, decision: AgentApprovalDecision): unknown {
  switch (pending.method) {
    case "item/commandExecution/requestApproval":
    case "item/fileChange/requestApproval":
      return { decision: APPROVAL_DECISION[decision] };
    case "execCommandApproval":
    case "applyPatchApproval":
      return { decision: LEGACY_DECISION[decision] };
    case "item/permissions/requestApproval": {
      const granted = decision === "allow-once" || decision === "allow-session";
      const requested = asRecord(pending.params.permissions);
      const permissions = granted
        ? Object.fromEntries(
            Object.entries(requested).filter(([, v]) => v !== null && v !== undefined),
          )
        : {};
      return { permissions, scope: decision === "allow-session" ? "session" : "turn" };
    }
    case "item/tool/requestUserInput":
      return { answers: {} };
    case "mcpServer/elicitation/request": {
      const answer = decision === "allow-once" ? confirmationAnswer(pending.params) : null;
      if (answer) return { action: "accept", content: answer, _meta: null };
      return { action: decision === "abort" ? "cancel" : "decline", content: null, _meta: null };
    }
    default:
      return {};
  }
}
