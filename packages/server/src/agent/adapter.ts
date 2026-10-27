import type {
  AgentApprovalDecision,
  AgentApprovalRequest,
  AgentEnvironment,
  AgentHistoryEntry,
  AgentItem,
  AgentMcpAction,
  AgentMcpServer,
  AgentProviderInfo,
  AgentSessionControls,
  AgentTurn,
  AgentTurnStatus,
} from "@velloo/protocol/agent";

/**
 * What the daemon decides for a session before any provider sees it. None of
 * it comes from the browser: the canvas names a provider, and the daemon picks
 * the directory, the MCP server and the instructions.
 */
export interface AgentLaunch {
  /** The directory the agent works in — the app the design belongs to. */
  cwd: string;
  /**
   * The Velloo MCP server for this design folder, added to the agent's own
   * servers: this daemon's HTTP endpoint, and the `velloo mcp <design>` command
   * that reaches it over stdio, for a provider that can only replace a stdio
   * entry with another.
   */
  mcp?: { name: string; url: string; command?: string[] };
  /** Tells the agent it is running inside the canvas, and on which design. */
  instructions: string;
  /** The provider's own session id, to reopen a conversation it kept. */
  resume?: string;
}

/**
 * Where an adapter reports what happened, already normalized. Calls may arrive
 * in any order a provider produces them; the session manager creates a turn the
 * first time anything names it.
 */
export interface AgentSink {
  /** The provider is ready, and this is what it runs with. */
  ready(info: {
    providerSessionId?: string;
    environment: AgentEnvironment;
    title?: string;
    resumable: boolean;
    terminalCommand?: string[];
  }): void;
  /** Turns the provider already had, when a session was reopened. */
  history(turns: AgentTurn[]): void;
  turnStarted(turnId: string): void;
  /** Insert or replace an item, whole. */
  item(turnId: string, item: AgentItem): void;
  /** Append streamed text to an item already sent. */
  delta(turnId: string, itemId: string, field: "text" | "output", delta: string): void;
  turnDiff(turnId: string, diff: string): void;
  turnCompleted(turnId: string, status: Exclude<AgentTurnStatus, "running">, error?: string): void;
  approval(request: AgentApprovalRequest): void;
  /** The provider withdrew a request (the turn ended, or another client answered). */
  approvalWithdrawn(approvalId: string): void;
  titled(title: string): void;
  /** What the session can be asked besides a prompt, whole, whenever it changes. */
  controls(controls: AgentSessionControls): void;
  /** A message about the session as a whole, outside any turn. */
  notice(level: "info" | "warning" | "error", text: string): void;
  /** The process is gone. An error means it was not asked to stop. */
  exited(error?: string): void;
}

/** A live provider process, driven by the session manager. */
export interface AgentConnection {
  /** Start a turn with this prompt, resolving to its id. */
  startTurn(text: string): Promise<string>;
  /** Add to the running turn, for a provider whose `followUp` is `steer`. */
  steer?(turnId: string, text: string): Promise<void>;
  interrupt(turnId: string): Promise<void>;
  answer(approvalId: string, decision: AgentApprovalDecision): Promise<void>;
  rename?(title: string): Promise<void>;
  /**
   * Switch to one of `controls.models`, for the turns after this one. Resolves
   * to the model's name as the environment should show it.
   */
  setModel?(model: string): Promise<string | undefined>;
  /**
   * Switch to one of `controls.modes`, from the next action on. Resolves to
   * what the environment should now say about the sandbox and approvals.
   */
  setMode?(mode: string): Promise<Partial<Pick<AgentEnvironment, "sandbox" | "approvalMode">>>;
  /** The agent's MCP servers, for `/mcp`. */
  mcpServers?(): Promise<AgentMcpServer[]>;
  /** One of `controls.mcp.actions` on a server. */
  mcpAction?(server: string, action: AgentMcpAction): Promise<void>;
  /** Stop the process. Resolves once it has exited. */
  close(): Promise<void>;
}

export interface AgentAdapter {
  readonly id: string;
  readonly label: string;
  /**
   * Offer this agent only when it can run here. Codex and Claude Code are
   * always listed, with how to install or sign in; an Agent Client Protocol
   * agent appears only once it's installed and speaks a compatible version.
   */
  readonly hiddenUnlessReady?: boolean;
  /** Is it installed, compatible and signed in? Cheap enough to call on demand. */
  discover(): Promise<AgentProviderInfo>;
  start(launch: AgentLaunch, sink: AgentSink): Promise<AgentConnection>;
  /** Past sessions the provider kept for this directory. */
  history?(cwd: string): Promise<AgentHistoryEntry[]>;
}

/**
 * Thrown by an adapter or the manager for a failure the person can act on.
 * Routes map `code` to a status; `message` is shown as written.
 */
export class AgentError extends Error {
  constructor(
    readonly code: "not-found" | "unavailable" | "conflict" | "invalid" | "limit",
    message: string,
  ) {
    super(message);
    this.name = "AgentError";
  }
}
