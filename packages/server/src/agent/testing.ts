import type {
  AgentApprovalDecision,
  AgentCapabilities,
  AgentHistoryEntry,
  AgentMcpAction,
  AgentMcpServer,
  AgentProviderInfo,
  AgentSessionControls,
} from "@velloo/protocol/agent";
import type { AgentAdapter, AgentConnection, AgentLaunch, AgentSink } from "./adapter.ts";

/**
 * A provider with no process: the test drives its sink by hand and reads back
 * what the manager asked of it. Lets the session lifecycle be tested without
 * Codex or Claude Code installed.
 */
export class FakeAgentAdapter implements AgentAdapter {
  readonly label = "Fake agent";
  info: Partial<AgentProviderInfo> = {};
  capabilities: AgentCapabilities = {
    resume: true,
    history: false,
    rename: false,
    interrupt: true,
    followUp: "queue",
    approvals: ["allow-once", "deny", "abort"],
    turnDiff: false,
  };
  launches: AgentLaunch[] = [];
  sink?: AgentSink;
  turns: string[] = [];
  steered: string[] = [];
  interrupted: string[] = [];
  answers: { approvalId: string; decision: AgentApprovalDecision }[] = [];
  closed = 0;
  history?: (cwd: string) => Promise<AgentHistoryEntry[]>;
  /** Make the next `start` throw this. */
  failStart: Error | undefined;
  /** Sent once a session starts; a connection then offers what they name. */
  controls: AgentSessionControls | undefined;
  mcp: AgentMcpServer[] = [];
  models: string[] = [];
  modeChanges: string[] = [];
  mcpActions: { server: string; action: AgentMcpAction }[] = [];
  private turnCount = 0;

  constructor(readonly id = "fake") {}

  async discover(): Promise<AgentProviderInfo> {
    return {
      id: this.id,
      label: this.label,
      status: "ready",
      version: "1.0.0",
      capabilities: this.capabilities,
      ...this.info,
    };
  }

  async start(launch: AgentLaunch, sink: AgentSink): Promise<AgentConnection> {
    if (this.failStart) {
      const error = this.failStart;
      this.failStart = undefined;
      throw error;
    }
    this.launches.push(launch);
    this.sink = sink;
    sink.ready({
      providerSessionId: launch.resume ?? `fake-${this.launches.length}`,
      environment: {
        execution: "local",
        host: "test",
        cwd: launch.cwd,
        sandbox: "workspace-write",
        approvalMode: "on-request",
        providerVersion: "1.0.0",
      },
      resumable: true,
      terminalCommand: ["fake", "resume"],
    });
    const conn: AgentConnection = {
      startTurn: async (text) => {
        this.turns.push(text);
        const id = `turn-${++this.turnCount}`;
        sink.turnStarted(id);
        return id;
      },
      interrupt: async (turnId) => {
        this.interrupted.push(turnId);
        sink.turnCompleted(turnId, "interrupted");
      },
      answer: async (approvalId, decision) => {
        this.answers.push({ approvalId, decision });
      },
      close: async () => {
        this.closed++;
        sink.exited();
      },
    };
    if (this.controls) {
      sink.controls(this.controls);
      conn.setModel = async (model) => {
        this.models.push(model);
        return `${model}-resolved`;
      };
      conn.setMode = async (mode) => {
        this.modeChanges.push(mode);
        return { sandbox: mode };
      };
      conn.mcpServers = async () => this.mcp;
      conn.mcpAction = async (server, action) => {
        this.mcpActions.push({ server, action });
      };
    }
    if (this.capabilities.followUp === "steer") {
      conn.steer = async (_turnId, text) => {
        this.steered.push(text);
      };
    }
    return conn;
  }
}
