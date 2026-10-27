import { z } from "zod";

/**
 * The agent conversation contract — what the canvas's Agent tab renders, and
 * what the daemon turns each local CLI agent's own protocol into.
 *
 * Every shape here is *normalized*: a provider's raw messages (Codex
 * app-server notifications, Claude Code stream-json lines) never cross this
 * boundary, so the canvas cannot grow a dependency on one provider's event
 * names and nothing a provider sends — tokens, account ids, raw tool payloads
 * — is persisted by accident. The presentation components consume only these
 * types, which is what lets the hosted design agent (a later, separate
 * initiative) render through them too: a cloud run produces turns and items,
 * not processes.
 *
 * Zod-only on purpose, like `/comments`: velloo-cloud can import it without a
 * velloo checkout.
 */

/**
 * Bumped when a change to these shapes would make an older canvas misread a
 * newer daemon's frames. Every frame carries it; a canvas that sees another
 * version asks for a reload instead of rendering half a conversation.
 */
export const AGENT_PROTOCOL_VERSION = 2;

/** Identifies an adapter. Open-ended: Agent Client Protocol agents add their own. */
export const AgentProviderIdSchema = z.string().regex(/^[a-z][a-z0-9-]{0,39}$/);
export type AgentProviderId = z.infer<typeof AgentProviderIdSchema>;

/**
 * What a person can answer to an approval request. A provider offers the subset
 * it supports — the UI shows only those, never a choice the provider would
 * silently treat as another.
 *
 * - `allow-once`: run this one action.
 * - `allow-session`: run it, and stop asking for the same kind of action in
 *   this session (the provider's own notion of "the same").
 * - `allow-always`: run it, and save the rule the provider proposed where the
 *   provider keeps it, as its own "don't ask again" would. Offered only when
 *   the provider proposed one; the request's `always` says what is saved.
 * - `deny`: refuse it; the agent continues and may try something else.
 * - `abort`: refuse it and stop the turn.
 */
export const AgentApprovalDecisionSchema = z.enum([
  "allow-once",
  "allow-session",
  "allow-always",
  "deny",
  "abort",
]);
export type AgentApprovalDecision = z.infer<typeof AgentApprovalDecisionSchema>;

/**
 * What a provider can do, so the UI hides or explains an operation rather than
 * offering it and failing. Codex and Claude Code differ in real ways here —
 * Codex can rename a thread and send diffs per turn, Claude Code queues
 * follow-up messages instead of steering a running turn.
 */
export const AgentCapabilitiesSchema = z.object({
  /** A session can be reopened after its process ended. */
  resume: z.boolean(),
  /** Past sessions can be listed from the provider's own store. */
  history: z.boolean(),
  /** A session can be given a title the provider keeps. */
  rename: z.boolean(),
  /** A running turn can be interrupted. */
  interrupt: z.boolean(),
  /**
   * What sending while a turn is running does: `steer` adds to the running
   * turn, `queue` starts a turn after it, `none` waits for it to finish.
   */
  followUp: z.enum(["steer", "queue", "none"]),
  /** The decisions this provider can carry back. */
  approvals: z.array(AgentApprovalDecisionSchema),
  /** The provider reports a unified diff for a turn's file changes. */
  turnDiff: z.boolean(),
});
export type AgentCapabilities = z.infer<typeof AgentCapabilitiesSchema>;

/**
 * Whether a provider can start a session on this machine, and what the person
 * has to do when it can't. `message` is the actionable sentence ("Run `codex
 * login` in a terminal"), written by the daemon, never a raw stderr dump.
 */
export const AgentProviderStatusSchema = z.enum([
  "ready",
  "not-installed",
  "incompatible",
  "logged-out",
  "error",
]);
export type AgentProviderStatus = z.infer<typeof AgentProviderStatusSchema>;

export const AgentProviderInfoSchema = z.object({
  id: AgentProviderIdSchema,
  label: z.string(),
  status: AgentProviderStatusSchema,
  version: z.string().optional(),
  /** The minimum version this daemon speaks to, shown when `incompatible`. */
  minVersion: z.string().optional(),
  message: z.string().optional(),
  /**
   * How the person is signed in, as the provider describes it ("ChatGPT Plus",
   * "Claude Max"). A label only — never an email, key or token.
   */
  account: z.string().optional(),
  capabilities: AgentCapabilitiesSchema,
});
export type AgentProviderInfo = z.infer<typeof AgentProviderInfoSchema>;

/**
 * Where and with what authority a session runs — shown on the tab so the
 * person never has to guess what an approval would let the agent touch.
 */
export const AgentEnvironmentSchema = z.object({
  /** Always `local` here; a hosted run would say `cloud`. */
  execution: z.enum(["local", "cloud"]),
  host: z.string(),
  cwd: z.string(),
  /** The provider's sandbox or permission mode, in its own words ("workspace-write", "default"). */
  sandbox: z.string(),
  /** When the provider asks before acting ("on-request", "untrusted"). */
  approvalMode: z.string(),
  model: z.string().optional(),
  providerVersion: z.string().optional(),
});
export type AgentEnvironment = z.infer<typeof AgentEnvironmentSchema>;

export const AgentSessionStateSchema = z.enum([
  /** The provider process is starting or handshaking. */
  "starting",
  /** Ready for a prompt. */
  "idle",
  /** A turn is running. */
  "running",
  /** A turn is waiting on the person to answer an approval. */
  "awaiting-approval",
  /** The process ended — closed by the person, or found here after a daemon restart. */
  "exited",
  /** The process ended unexpectedly. */
  "failed",
]);
export type AgentSessionState = z.infer<typeof AgentSessionStateSchema>;

export const AgentSessionSummarySchema = z.object({
  id: z.string(),
  provider: AgentProviderIdSchema,
  title: z.string(),
  state: AgentSessionStateSchema,
  /** Why it failed, or what the person can do about an exited session. */
  stateMessage: z.string().optional(),
  /** The provider's own id for the conversation, when it has one. */
  providerSessionId: z.string().optional(),
  /** It can be reopened: the provider kept it, and supports resuming. */
  resumable: z.boolean(),
  environment: AgentEnvironmentSchema.optional(),
  /**
   * The command that continues this session in a terminal — the hand-off to the
   * embedded terminal when it exists, or to the person's own. The session's
   * bytes never travel through this protocol; the terminal resumes it from the
   * provider's own store.
   */
  terminalCommand: z.array(z.string()).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AgentSessionSummary = z.infer<typeof AgentSessionSummarySchema>;

/**
 * Something attached to a prompt from the canvas — a board, a frame, a node,
 * a preview, a comment. The daemon expands each into text the agent reads; the
 * UI shows it as a card. `ref` is the canvas's own address for it, so a card
 * in a sent turn can take the person back to what it named.
 */
export const AgentContextKindSchema = z.enum([
  /**
   * Where the person is in the canvas when they send: the open board, the
   * screen in view, the selected node. Sent with every message unless they
   * remove it, so "this board" means something to the agent.
   */
  "view",
  "board",
  "screen",
  "frame",
  "node",
  "preview",
  "note",
  "comment",
]);
export type AgentContextKind = z.infer<typeof AgentContextKindSchema>;

export const AgentContextRefSchema = z.object({
  boardId: z.string().optional(),
  screenId: z.string().optional(),
  frameId: z.string().optional(),
  /** A node's dotted child-index path within its screen. */
  path: z.string().optional(),
  noteId: z.string().optional(),
  threadId: z.string().optional(),
  messageId: z.string().optional(),
});
export type AgentContextRef = z.infer<typeof AgentContextRefSchema>;

export const AgentContextCardSchema = z.object({
  kind: AgentContextKindSchema,
  ref: AgentContextRefSchema,
  /** What the card reads as ("Pricing / Hero / Button"). */
  label: z.string(),
  /** A second line: a comment's excerpt, a node's component. */
  detail: z.string().optional(),
  /** Who wrote it, for a comment. */
  author: z.string().optional(),
});
export type AgentContextCard = z.infer<typeof AgentContextCardSchema>;

const status = z.enum(["running", "completed", "failed", "declined"]);
export type AgentItemStatus = z.infer<typeof status>;

/**
 * One unit of a turn, in the order it happened. The variants are what a person
 * reads, not what a provider calls them: Codex's `commandExecution` and Claude
 * Code's `Bash` tool are both a `command`; its `fileChange` and Claude's
 * `Edit`/`Write` both a `file-change`.
 */
export const AgentItemSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("user"),
    id: z.string(),
    text: z.string(),
    context: z.array(AgentContextCardSchema).optional(),
  }),
  z.object({
    kind: z.literal("agent-text"),
    id: z.string(),
    text: z.string(),
    /** `commentary` is narration between steps; `final` is the turn's answer. */
    phase: z.enum(["commentary", "final"]).optional(),
  }),
  z.object({ kind: z.literal("reasoning"), id: z.string(), text: z.string() }),
  z.object({
    kind: z.literal("command"),
    id: z.string(),
    command: z.string(),
    cwd: z.string().optional(),
    status,
    output: z.string(),
    /** The output kept is the tail; this says how much was dropped before it. */
    outputDropped: z.number().int().nonnegative().optional(),
    exitCode: z.number().int().nullable().optional(),
    durationMs: z.number().nonnegative().optional(),
  }),
  z.object({
    kind: z.literal("file-change"),
    id: z.string(),
    status,
    changes: z.array(
      z.object({
        path: z.string(),
        change: z.enum(["add", "delete", "update"]),
        /** Unified diff, when the provider gave one. Truncated past a bound. */
        diff: z.string().optional(),
        diffTruncated: z.boolean().optional(),
      }),
    ),
  }),
  z.object({
    kind: z.literal("tool"),
    id: z.string(),
    /** The tool's name as the agent called it (`compose`, `WebFetch`). */
    name: z.string(),
    /** The MCP server it belongs to, for an MCP tool (`velloo`). */
    server: z.string().optional(),
    status,
    /** A short rendering of the arguments — not the raw payload. */
    input: z.string().optional(),
    output: z.string().optional(),
  }),
  z.object({
    kind: z.literal("subagent"),
    id: z.string(),
    description: z.string(),
    status,
  }),
  z.object({
    kind: z.literal("plan"),
    id: z.string(),
    steps: z.array(
      z.object({ text: z.string(), status: z.enum(["pending", "in-progress", "completed"]) }),
    ),
  }),
  z.object({
    kind: z.literal("notice"),
    id: z.string(),
    level: z.enum(["info", "warning", "error"]),
    text: z.string(),
  }),
]);
export type AgentItem = z.infer<typeof AgentItemSchema>;
export type AgentItemKind = AgentItem["kind"];

export const AgentTurnStatusSchema = z.enum(["running", "completed", "interrupted", "failed"]);
export type AgentTurnStatus = z.infer<typeof AgentTurnStatusSchema>;

export const AgentTurnSchema = z.object({
  id: z.string(),
  status: AgentTurnStatusSchema,
  items: z.array(AgentItemSchema),
  error: z.string().optional(),
  /** The turn's combined unified diff, when the provider reports one. */
  diff: z.string().optional(),
  startedAt: z.string(),
  completedAt: z.string().optional(),
});
export type AgentTurn = z.infer<typeof AgentTurnSchema>;

/**
 * An action waiting on the person. `title` names it in a sentence; the
 * specific fields let the UI show the exact command, files or tool input.
 */
export const AgentApprovalRequestSchema = z.object({
  id: z.string(),
  turnId: z.string().optional(),
  /** The item this approval gates, when the provider says. */
  itemId: z.string().optional(),
  kind: z.enum(["command", "file-change", "tool", "permissions", "question"]),
  title: z.string(),
  reason: z.string().optional(),
  command: z.string().optional(),
  cwd: z.string().optional(),
  tool: z.string().optional(),
  input: z.string().optional(),
  paths: z.array(z.string()).optional(),
  decisions: z.array(AgentApprovalDecisionSchema).min(1),
  /** What `allow-always` saves, and where, in a sentence. */
  always: z.string().optional(),
  requestedAt: z.string(),
});
export type AgentApprovalRequest = z.infer<typeof AgentApprovalRequestSchema>;

/**
 * A command the agent offers by name — a skill, a custom prompt, one of its
 * own slash commands. The canvas sends it as the message `/name args`, which
 * is how the agent's own terminal would.
 */
export const AgentCommandSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  /** What follows the name ("[file]", "<pr number>"), when it takes anything. */
  argumentHint: z.string().optional(),
});
export type AgentCommand = z.infer<typeof AgentCommandSchema>;

/** A model a session can switch to, in the provider's own terms. */
export const AgentModelOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string(),
  description: z.string().optional(),
});
export type AgentModelOption = z.infer<typeof AgentModelOptionSchema>;

/**
 * A permission mode the session can switch to — the agent's own (Claude Code's
 * "Accept edits", Codex's read-only sandbox, an ACP agent's session modes).
 * Modes that turn approvals off altogether are never offered from the canvas.
 */
export const AgentModeOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string(),
  description: z.string().optional(),
});
export type AgentModeOption = z.infer<typeof AgentModeOptionSchema>;

/**
 * What `/mcp` can do to one of the agent's MCP servers: try it again, or turn
 * it off or on for this session. None of them changes the person's config.
 */
export const AgentMcpActionSchema = z.enum(["reconnect", "enable", "disable"]);
export type AgentMcpAction = z.infer<typeof AgentMcpActionSchema>;

/**
 * What a running session can be asked besides a prompt — the slash menu's
 * contents. Live only: an exited session has none, and they are never stored.
 */
export const AgentSessionControlsSchema = z.object({
  /** The agent's own commands. */
  commands: z.array(AgentCommandSchema),
  /** The models `/model` offers; empty when the provider can't switch. */
  models: z.array(AgentModelOptionSchema),
  /** The option in `models` the session runs now, when known. */
  model: z.string().optional(),
  /** The permission modes the person can switch to from the canvas. */
  modes: z.array(AgentModeOptionSchema).optional(),
  /** The mode the session runs in now — possibly one not in `modes`, set in the agent's own config. */
  mode: z.string().optional(),
  /** `/mcp`: the provider can list its servers, and these actions. Absent when it can't. */
  mcp: z.object({ actions: z.array(AgentMcpActionSchema) }).optional(),
});
export type AgentSessionControls = z.infer<typeof AgentSessionControlsSchema>;

/** One of the agent's MCP servers, as `/mcp` shows it. */
export const AgentMcpServerSchema = z.object({
  name: z.string(),
  status: z.enum(["connected", "starting", "needs-auth", "failed", "disabled", "unknown"]),
  /** Why it failed, or where it is configured. */
  detail: z.string().optional(),
  tools: z.number().int().nonnegative().optional(),
  /** The server Velloo added for this design. */
  velloo: z.boolean().optional(),
});
export type AgentMcpServer = z.infer<typeof AgentMcpServerSchema>;

/**
 * Everything the canvas needs to draw a session from nothing — after a
 * reload, a reconnect, or a daemon restart. Live frames then patch it.
 */
export const AgentSessionSnapshotSchema = z.object({
  session: AgentSessionSummarySchema,
  turns: z.array(AgentTurnSchema),
  /** Older turns exist but were not sent (`turns` is the tail). */
  turnsDropped: z.number().int().nonnegative(),
  approvals: z.array(AgentApprovalRequestSchema),
  /** Prompts accepted while a turn ran, for a provider that queues. */
  queued: z.array(z.object({ id: z.string(), text: z.string() })),
  controls: AgentSessionControlsSchema.optional(),
});
export type AgentSessionSnapshot = z.infer<typeof AgentSessionSnapshotSchema>;

export const AGENT_EVENT_TYPE = "agent";

/**
 * A live change, pushed on the canvas socket. Frames upsert by id — an `item`
 * frame carries the whole item — except `delta`, which appends streamed text to
 * one field of an item already sent, so a long answer isn't resent per token.
 */
export const AgentEventSchema = z.discriminatedUnion("event", [
  z.object({ event: z.literal("providers"), providers: z.array(AgentProviderInfoSchema) }),
  z.object({ event: z.literal("session"), session: AgentSessionSummarySchema }),
  z.object({ event: z.literal("session-removed"), sessionId: z.string() }),
  z.object({
    event: z.literal("turn"),
    sessionId: z.string(),
    turn: AgentTurnSchema.omit({ items: true }),
  }),
  z.object({
    event: z.literal("item"),
    sessionId: z.string(),
    turnId: z.string(),
    item: AgentItemSchema,
  }),
  z.object({
    event: z.literal("delta"),
    sessionId: z.string(),
    turnId: z.string(),
    itemId: z.string(),
    field: z.enum(["text", "output"]),
    delta: z.string(),
  }),
  z.object({
    event: z.literal("approval"),
    sessionId: z.string(),
    request: AgentApprovalRequestSchema,
  }),
  z.object({
    event: z.literal("approval-resolved"),
    sessionId: z.string(),
    approvalId: z.string(),
    decision: AgentApprovalDecisionSchema.optional(),
  }),
  z.object({
    event: z.literal("queue"),
    sessionId: z.string(),
    queued: z.array(z.object({ id: z.string(), text: z.string() })),
  }),
  /** The session's controls changed; null once its process is gone. */
  z.object({
    event: z.literal("controls"),
    sessionId: z.string(),
    controls: AgentSessionControlsSchema.nullable(),
  }),
]);
export type AgentEvent = z.infer<typeof AgentEventSchema>;

/** The socket frame: an `AgentEvent` stamped with the frame type and version. */
export type AgentFrame = AgentEvent & { type: typeof AGENT_EVENT_TYPE; v: number };

/** Parse an `agent` frame's body, returning null for anything unusable. */
export function parseAgentFrame(raw: unknown): AgentFrame | null {
  if (!raw || typeof raw !== "object") return null;
  const frame = raw as { type?: unknown; v?: unknown };
  if (frame.type !== AGENT_EVENT_TYPE || typeof frame.v !== "number") return null;
  const parsed = AgentEventSchema.safeParse(raw);
  return parsed.success ? { ...parsed.data, type: AGENT_EVENT_TYPE, v: frame.v } : null;
}

/** What the canvas sends to start a turn. The daemon decides everything else. */
export const AgentPromptBodySchema = z.strictObject({
  text: z.string().max(100_000),
  context: z.array(AgentContextCardSchema).max(50).optional(),
});
export type AgentPromptBody = z.infer<typeof AgentPromptBodySchema>;

/**
 * Starting a session names a provider and, to reopen one, the provider's own
 * session id — nothing else. Working directory, executable, sandbox and
 * environment are the daemon's to decide, so a page that reaches this API
 * cannot widen what the agent may touch.
 */
export const AgentStartBodySchema = z.strictObject({
  provider: AgentProviderIdSchema,
  resume: z.string().min(1).max(200).optional(),
});
export type AgentStartBody = z.infer<typeof AgentStartBodySchema>;

export const AgentApprovalBodySchema = z.strictObject({ decision: AgentApprovalDecisionSchema });

/** `/model`: one of the session's `controls.models`, by id. */
export const AgentModelBodySchema = z.strictObject({ model: z.string().min(1).max(200) });

/** One of the session's `controls.modes`, by id. */
export const AgentModeBodySchema = z.strictObject({ mode: z.string().min(1).max(100) });

/** `/mcp`: an action on one of the agent's servers, by name. */
export const AgentMcpActionBodySchema = z.strictObject({
  server: z.string().min(1).max(200),
  action: AgentMcpActionSchema,
});

export const AgentRenameBodySchema = z.strictObject({ title: z.string().trim().min(1).max(120) });

/** A past session the provider kept, offered for resuming. */
export const AgentHistoryEntrySchema = z.object({
  providerSessionId: z.string(),
  title: z.string(),
  updatedAt: z.string(),
});
export type AgentHistoryEntry = z.infer<typeof AgentHistoryEntrySchema>;
