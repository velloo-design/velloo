import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  AGENT_EVENT_TYPE,
  AGENT_PROTOCOL_VERSION,
  type AgentAnswers,
  type AgentApprovalDecision,
  type AgentApprovalRequest,
  type AgentEvent,
  type AgentFrame,
  type AgentHistoryEntry,
  type AgentItem,
  type AgentMcpAction,
  type AgentMcpServer,
  type AgentPromptBody,
  type AgentProviderInfo,
  type AgentSessionControls,
  type AgentSessionSnapshot,
  type AgentSessionSummary,
  AgentSessionSummarySchema,
  type AgentStartBody,
  type AgentTurn,
  AgentTurnSchema,
} from "@velloo/protocol/agent";
import { z } from "zod";
import { writeJsonAtomic } from "../fs.ts";
import {
  type AgentAdapter,
  type AgentConnection,
  AgentError,
  type AgentLaunch,
  type AgentSink,
} from "./adapter.ts";
import { boundItem, LIMITS, tail } from "./bounds.ts";

/**
 * Where every checkout of a design kept its sessions before each had its own:
 * keyed by the checked-in folder id alone, which a worktree or a clone shares.
 */
export function legacyAgentSessionsDir(folderId: string): string {
  const safe = folderId.replace(/[^A-Za-z0-9_-]/g, "_");
  return join(process.env.VELLOO_AGENTS_DIR ?? join(homedir(), ".velloo", "agents"), safe);
}

/**
 * Machine-local, per design folder and per checkout of it — beside local
 * comments, never in the checkout. A session belongs to the directory its
 * agent ran in, so a worktree must not list (and fail to reopen) another's.
 */
export function agentSessionsDir(folderId: string, root: string): string {
  const checkout = createHash("sha256").update(realOr(root)).digest("hex").slice(0, 16);
  return join(legacyAgentSessionsDir(folderId), checkout);
}

function realOr(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

const PersistedSessionSchema = z.object({
  version: z.literal(1),
  session: AgentSessionSummarySchema,
  turns: z.array(AgentTurnSchema),
  turnsDropped: z.number().int().nonnegative(),
});

interface Session {
  summary: AgentSessionSummary;
  turns: AgentTurn[];
  turnsDropped: number;
  approvals: Map<string, AgentApprovalRequest>;
  queued: { id: string; text: string }[];
  adapter: AgentAdapter;
  conn: AgentConnection | undefined;
  /** Its process is being started: `conn` isn't set yet, but it counts as live. */
  launching: boolean;
  activeTurn: string | undefined;
  /** The person asked it to stop, so an exit is not a failure. */
  closing: boolean;
  /** The title came from the provider or the person, not the first prompt. */
  named: boolean;
  /**
   * Bumped per process launch. A sink belongs to one launch, so late events
   * from a process that was replaced are dropped instead of written into the
   * next run's transcript.
   */
  generation: number;
  saveTimer: ReturnType<typeof setTimeout> | undefined;
  /** Notices that arrived before the turn they belong to had an id. */
  pendingNotices: AgentItem[];
  /** What the live process offers besides prompts; gone with the process. */
  controls: AgentSessionControls | undefined;
}

export interface AgentSessionManagerOptions {
  adapters: AgentAdapter[];
  broadcast: (frame: AgentFrame) => void;
  /** Resolved per session start, so a config change between sessions is honoured. */
  launch: () => Omit<AgentLaunch, "resume">;
  storeDir: string;
  /**
   * A store shared by every checkout, from before each had its own. `load`
   * moves out of it the sessions that ran in this checkout's directory.
   */
  legacyStoreDir?: string;
  /** Turn the canvas's prompt (text plus context cards) into what the agent reads. */
  expand?: (body: AgentPromptBody) => Promise<string> | string;
  /** Provider processes that may run at once. */
  maxLive?: number;
  /** How long a start waits on probing its agent before starting it anyway. */
  probeDeadlineMs?: number;
}

const DEFAULT_TITLE = "New session";
const PROVIDER_CACHE_MS = 30_000;
const PROBE_DEADLINE_MS = 5_000;

/**
 * Owns every local agent session for one design folder: the provider
 * processes, their lifecycle, and a bounded, normalized history that outlives
 * a browser tab and a daemon restart.
 *
 * The browser only ever holds a projection. It reads a snapshot on load and
 * patches it from `agent` frames; a reconnect reads the snapshot again. What
 * is written to disk is the same normalized history — never a provider's raw
 * payload, environment or credentials.
 */
export class AgentSessionManager {
  private readonly sessions = new Map<string, Session>();
  /** Prompts waiting in a queue, with the text the agent will read. */
  private readonly pending = new Map<string, { item: AgentItem; text: string }>();
  private readonly adapters: Map<string, AgentAdapter>;
  private providerCache: { at: number; providers: AgentProviderInfo[] } | undefined;
  /** Each agent's last answer to a probe, whatever its age. */
  private readonly known = new Map<string, AgentProviderInfo>();
  /** Agents whose "ready" a failed turn put in doubt (often a lapsed sign-in). */
  private readonly doubted = new Set<string>();

  constructor(private readonly opts: AgentSessionManagerOptions) {
    this.adapters = new Map(opts.adapters.map((a) => [a.id, a]));
  }

  /** Read the sessions a previous daemon left. None of their processes survived it. */
  async load(): Promise<void> {
    if (this.opts.legacyStoreDir) await this.adoptLegacy(this.opts.legacyStoreDir);
    let files: string[];
    try {
      files = await readdir(this.opts.storeDir);
    } catch {
      return;
    }
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const raw: unknown = JSON.parse(await readFile(join(this.opts.storeDir, file), "utf8"));
        const parsed = PersistedSessionSchema.safeParse(raw);
        if (!parsed.success) continue;
        const { session, turns, turnsDropped } = parsed.data;
        const adapter = this.adapters.get(session.provider);
        if (!adapter || this.sessions.has(session.id)) continue;
        const wasLive = session.state !== "exited" && session.state !== "failed";
        this.sessions.set(session.id, {
          summary: wasLive
            ? {
                ...session,
                state: "exited",
                stateMessage: session.resumable
                  ? "Velloo restarted. Reopen the session to continue it."
                  : "Velloo restarted, and this session can't be reopened.",
              }
            : session,
          turns: turns.map((turn) =>
            turn.status === "running" ? { ...turn, status: "interrupted" } : turn,
          ),
          turnsDropped,
          approvals: new Map(),
          queued: [],
          adapter,
          conn: undefined,
          activeTurn: undefined,
          saveTimer: undefined,
          closing: false,
          launching: false,
          named: session.title !== DEFAULT_TITLE,
          generation: 0,
          pendingNotices: [],
          controls: undefined,
        });
      } catch {
        // A file another version wrote, or one cut short; it isn't ours to repair.
      }
    }
  }

  async providers(refresh = false): Promise<AgentProviderInfo[]> {
    const cached = this.providerCache;
    if (!refresh && cached && Date.now() - cached.at < PROVIDER_CACHE_MS) return cached.providers;
    const providers = await Promise.all(
      [...this.adapters.values()].map((adapter) => this.discover(adapter)),
    );
    for (const info of providers) this.known.set(info.id, info);
    this.doubted.clear();
    const offered = providers.filter((p) => this.offered(p));
    this.providerCache = { at: Date.now(), providers: offered };
    this.emit({ event: "providers", providers: offered });
    return offered;
  }

  list(): AgentSessionSummary[] {
    return [...this.sessions.values()]
      .map((s) => s.summary)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  /** Sessions with a running provider process, idle or not — what `maxLive` bounds. */
  liveCount(): number {
    let n = 0;
    for (const s of this.sessions.values()) if (s.conn || s.launching) n++;
    return n;
  }

  /**
   * Sessions at work: starting, or in a turn that isn't waiting on a person.
   * Only these keep the daemon up after the canvas closes — an idle session,
   * or an approval no one is there to see, would otherwise hold it (and the
   * agent) forever.
   */
  busyCount(): number {
    let n = 0;
    for (const s of this.sessions.values()) {
      if (s.launching || (s.conn && s.activeTurn && s.approvals.size === 0)) n++;
    }
    return n;
  }

  snapshot(id: string): AgentSessionSnapshot {
    const s = this.get(id);
    const start = Math.max(0, s.turns.length - LIMITS.snapshotTurns);
    return {
      session: s.summary,
      turns: s.turns.slice(start),
      turnsDropped: s.turnsDropped + start,
      approvals: [...s.approvals.values()],
      queued: s.queued,
      ...(s.controls ? { controls: s.controls } : {}),
    };
  }

  async history(provider: string): Promise<AgentHistoryEntry[]> {
    const adapter = this.adapterFor(provider);
    if (!adapter.history) return [];
    // A session the tab already lists is reopened from that list, not this one.
    const known = new Set(
      [...this.sessions.values()]
        .filter((s) => s.summary.provider === adapter.id)
        .map((s) => s.summary.providerSessionId),
    );
    const entries = await adapter.history(this.opts.launch().cwd);
    return entries.filter((e) => !known.has(e.providerSessionId));
  }

  async start(body: AgentStartBody): Promise<AgentSessionSummary> {
    const adapter = this.adapterFor(body.provider);
    const info = await this.infoFor(adapter);
    if (info && info.status !== "ready") {
      throw new AgentError("unavailable", info.message ?? `${adapter.label} is not ready.`);
    }
    if (body.resume) {
      const known = [...this.sessions.values()].find(
        (s) => s.summary.provider === adapter.id && s.summary.providerSessionId === body.resume,
      );
      if (known) return this.reopen(known.summary.id);
    }
    const now = new Date().toISOString();
    const session: Session = {
      summary: {
        id: crypto.randomUUID(),
        provider: adapter.id,
        title: DEFAULT_TITLE,
        state: "starting",
        resumable: false,
        createdAt: now,
        updatedAt: now,
        ...(body.resume ? { providerSessionId: body.resume } : {}),
      },
      turns: [],
      turnsDropped: 0,
      approvals: new Map(),
      queued: [],
      adapter,
      conn: undefined,
      activeTurn: undefined,
      saveTimer: undefined,
      closing: false,
      launching: false,
      named: false,
      generation: 0,
      pendingNotices: [],
      controls: undefined,
    };
    this.sessions.set(session.summary.id, session);
    await this.launch(session, body.resume);
    return session.summary;
  }

  /** Start a new process for a session that exited, continuing the provider's conversation. */
  async reopen(id: string): Promise<AgentSessionSummary> {
    const s = this.get(id);
    if (s.conn) return s.summary;
    if (!s.summary.resumable || !s.summary.providerSessionId) {
      throw new AgentError("conflict", "This session can't be reopened. Start a new one.");
    }
    s.closing = false;
    this.update(s, { state: "starting", stateMessage: undefined });
    await this.launch(s, s.summary.providerSessionId);
    return s.summary;
  }

  async prompt(
    id: string,
    body: AgentPromptBody,
  ): Promise<{ mode: "started" | "steered" | "queued"; turnId?: string }> {
    const s = this.get(id);
    if (!s.conn) {
      throw new AgentError("conflict", "This session isn't running. Reopen it or start a new one.");
    }
    const text = this.opts.expand ? await this.opts.expand(body) : body.text;
    if (!text.trim()) throw new AgentError("invalid", "There is nothing to send.");
    const userItem: AgentItem = {
      kind: "user",
      id: crypto.randomUUID(),
      text: body.text,
      ...(body.context?.length ? { context: body.context } : {}),
    };
    // The first prompt names a session no one named; later ones never rename it.
    if (!s.named && s.summary.title === DEFAULT_TITLE) {
      const first = body.text.trim().split("\n")[0] || body.context?.[0]?.label || "";
      if (first) this.update(s, { title: first.length > 60 ? `${first.slice(0, 59)}…` : first });
    }
    const running = s.activeTurn;
    if (running) {
      const info = this.known.get(s.adapter.id) ?? (await this.infoFor(s.adapter));
      const followUp = info?.capabilities.followUp ?? "none";
      if (followUp === "steer" && s.conn.steer && running !== "pending") {
        await s.conn.steer(running, text);
        this.putItem(s, running, userItem);
        return { mode: "steered", turnId: running };
      }
      if (followUp === "queue" || followUp === "steer") {
        s.queued.push({ id: userItem.id, text: body.text });
        this.pending.set(userItem.id, { item: userItem, text });
        this.emit({ event: "queue", sessionId: id, queued: s.queued });
        return { mode: "queued" };
      }
      throw new AgentError("conflict", "Wait for the current turn to finish, or interrupt it.");
    }
    return { mode: "started", turnId: await this.begin(s, text, userItem) };
  }

  /** Drop a prompt that was waiting for the running turn. */
  dequeue(id: string, queuedId: string): void {
    const s = this.get(id);
    s.queued = s.queued.filter((q) => q.id !== queuedId);
    this.pending.delete(queuedId);
    this.emit({ event: "queue", sessionId: id, queued: s.queued });
  }

  async interrupt(id: string): Promise<void> {
    const s = this.get(id);
    if (!s.conn || !s.activeTurn) return;
    await s.conn.interrupt(s.activeTurn);
  }

  async answer(
    id: string,
    approvalId: string,
    decision: AgentApprovalDecision,
    answers?: AgentAnswers,
  ): Promise<void> {
    const s = this.get(id);
    const request = s.approvals.get(approvalId);
    if (!request || !s.conn)
      throw new AgentError("not-found", "That request is no longer waiting.");
    if (!request.decisions.includes(decision)) {
      throw new AgentError("invalid", `This request can't be answered with "${decision}".`);
    }
    const asked = decision === "allow-once" ? request.questions : undefined;
    if (asked?.some((q) => !answers?.[q.id]?.some((a) => a.trim()))) {
      throw new AgentError("invalid", "Answer every question, or skip them.");
    }
    const given =
      asked && answers
        ? Object.fromEntries(asked.map((q) => [q.id, answers[q.id] ?? []]))
        : undefined;
    await s.conn.answer(approvalId, decision, given);
    this.resolveApproval(s, approvalId, decision);
  }

  async rename(id: string, title: string): Promise<AgentSessionSummary> {
    const s = this.get(id);
    await s.conn?.rename?.(title);
    s.named = true;
    this.update(s, { title });
    return s.summary;
  }

  /** `/model`: switch the session to one of the models its controls offer. */
  async setModel(id: string, model: string): Promise<AgentSessionSummary> {
    const s = this.get(id);
    const option = s.controls?.models.find((m) => m.id === model);
    if (!s.conn?.setModel || !s.controls || !option) {
      throw new AgentError("invalid", `${s.adapter.label} can't switch to that model here.`);
    }
    const shown = await s.conn.setModel(model);
    this.setControls(s, { ...s.controls, model });
    if (s.summary.environment) {
      this.update(s, { environment: { ...s.summary.environment, model: shown ?? option.label } });
    }
    return s.summary;
  }

  /** Switch the session's permission mode to one its controls offer. */
  async setMode(id: string, mode: string): Promise<AgentSessionSummary> {
    const s = this.get(id);
    const option = s.controls?.modes?.find((m) => m.id === mode);
    if (!s.conn?.setMode || !s.controls || !option) {
      throw new AgentError("invalid", `${s.adapter.label} can't switch to that mode from here.`);
    }
    const environment = await s.conn.setMode(mode);
    this.setControls(s, { ...s.controls, mode });
    if (s.summary.environment) {
      this.update(s, { environment: { ...s.summary.environment, ...environment } });
    }
    return s.summary;
  }

  /** `/mcp`: the agent's MCP servers, with the one Velloo added marked. */
  async mcpServers(id: string): Promise<AgentMcpServer[]> {
    const s = this.get(id);
    if (!s.conn?.mcpServers || !s.controls?.mcp) {
      throw new AgentError("invalid", `${s.adapter.label} doesn't report its MCP servers.`);
    }
    const ours = this.opts.launch().mcp?.name;
    const servers = await s.conn.mcpServers();
    return servers.map((server) => (server.name === ours ? { ...server, velloo: true } : server));
  }

  async mcpAction(id: string, server: string, action: AgentMcpAction): Promise<void> {
    const s = this.get(id);
    if (!s.conn?.mcpAction || !s.controls?.mcp?.actions.includes(action)) {
      throw new AgentError(
        "invalid",
        `${s.adapter.label} can't ${action} an MCP server from here.`,
      );
    }
    await s.conn.mcpAction(server, action);
  }

  /** Stop the provider process. The transcript stays, and a resumable session can be reopened. */
  async terminate(id: string): Promise<void> {
    const s = this.get(id);
    // A process still starting is closed by `launch` as soon as it's up.
    if (s.launching) s.closing = true;
    if (!s.conn) return;
    s.closing = true;
    const conn = s.conn;
    await conn.close();
    // An adapter reports its exit through the sink; this covers one that didn't.
    if (s.conn === conn) this.onExit(s);
  }

  /** Forget a session: stop it, and delete its history from this machine. */
  async remove(id: string): Promise<void> {
    const s = this.get(id);
    await this.terminate(id);
    clearTimeout(s.saveTimer);
    this.sessions.delete(id);
    await rm(this.fileFor(id), { force: true });
    this.emit({ event: "session-removed", sessionId: id });
  }

  /** Stop every process and write every history. Called when the daemon stops. */
  async closeAll(): Promise<void> {
    await Promise.all(
      [...this.sessions.values()].map(async (s) => {
        if (s.conn) {
          s.closing = true;
          await s.conn.close().catch(() => undefined);
          if (s.conn) this.onExit(s);
        }
        clearTimeout(s.saveTimer);
        await this.save(s);
      }),
    );
  }

  // ── internals ────────────────────────────────────────────────────────────

  private discover(adapter: AgentAdapter): Promise<AgentProviderInfo> {
    return adapter.discover().catch(
      (error): AgentProviderInfo => ({
        id: adapter.id,
        label: adapter.label,
        status: "error",
        message: error instanceof Error ? error.message : String(error),
        capabilities: {
          resume: false,
          history: false,
          rename: false,
          interrupt: false,
          followUp: "none",
          approvals: ["deny"],
          turnDiff: false,
        },
      }),
    );
  }

  private offered(info: AgentProviderInfo): boolean {
    return (
      !this.adapters.get(info.id)?.hiddenUnlessReady ||
      (info.status !== "not-installed" && info.status !== "incompatible")
    );
  }

  /**
   * What a start or a follow-up needs to know about one agent. Rediscovering
   * every installed agent here made a start wait on the slowest of them, so
   * a known "ready" is trusted, and otherwise only this agent is probed, for
   * at most `probeDeadlineMs`. Undefined when it didn't answer in time: the
   * start then goes ahead and the launch reports its own failure.
   */
  private async infoFor(adapter: AgentAdapter): Promise<AgentProviderInfo | undefined> {
    const known = this.known.get(adapter.id);
    if (known?.status === "ready" && !this.doubted.has(adapter.id)) return known;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const probed = await Promise.race([
      this.discover(adapter),
      new Promise<undefined>((done) => {
        timer = setTimeout(() => done(undefined), this.opts.probeDeadlineMs ?? PROBE_DEADLINE_MS);
      }),
    ]);
    clearTimeout(timer);
    if (!probed) return undefined;
    this.known.set(adapter.id, probed);
    this.doubted.delete(adapter.id);
    const cached = this.providerCache;
    if (cached) {
      const rest = cached.providers.filter((p) => p.id !== adapter.id);
      const order = [...this.adapters.keys()];
      const providers = (this.offered(probed) ? [...rest, probed] : rest).sort(
        (a, b) => order.indexOf(a.id) - order.indexOf(b.id),
      );
      this.providerCache = { at: cached.at, providers };
      this.emit({ event: "providers", providers });
    }
    return probed;
  }

  /**
   * Take the shared store's sessions that ran here. One that never reported a
   * directory never started, so whichever checkout looks first may keep it.
   */
  private async adoptLegacy(legacy: string): Promise<void> {
    let files: string[];
    try {
      files = await readdir(legacy);
    } catch {
      return;
    }
    const here = realOr(this.opts.launch().cwd);
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const from = join(legacy, file);
      try {
        const raw: unknown = JSON.parse(await readFile(from, "utf8"));
        const parsed = PersistedSessionSchema.safeParse(raw);
        if (!parsed.success) continue;
        const cwd = parsed.data.session.environment?.cwd;
        if (cwd && realOr(cwd) !== here) continue;
        await mkdir(this.opts.storeDir, { recursive: true });
        await rename(from, join(this.opts.storeDir, file));
      } catch {
        // Unreadable, or another checkout moved it first.
      }
    }
  }

  private get(id: string): Session {
    const s = this.sessions.get(id);
    if (!s) throw new AgentError("not-found", "No such agent session.");
    return s;
  }

  private adapterFor(provider: string): AgentAdapter {
    const adapter = this.adapters.get(provider);
    if (!adapter) throw new AgentError("not-found", `Unknown agent provider "${provider}".`);
    return adapter;
  }

  private async launch(s: Session, resume: string | undefined): Promise<void> {
    if (this.liveCount() >= (this.opts.maxLive ?? 4)) {
      this.update(s, { state: "exited", stateMessage: "Too many sessions are running." });
      throw new AgentError("limit", "Too many agent sessions are running. Close one first.");
    }
    const launch = { ...this.opts.launch(), ...(resume ? { resume } : {}) };
    s.generation++;
    s.launching = true;
    try {
      s.conn = await s.adapter.start(launch, this.sinkFor(s, s.generation));
    } catch (error) {
      s.conn = undefined;
      const message = error instanceof Error ? error.message : String(error);
      this.update(s, { state: "failed", stateMessage: message });
      throw error instanceof AgentError ? error : new AgentError("unavailable", message);
    } finally {
      s.launching = false;
    }
    // Stopped or deleted while it was starting.
    if (s.closing || this.sessions.get(s.summary.id) !== s) {
      const conn = s.conn;
      s.closing = true;
      await conn.close().catch(() => undefined);
      if (s.conn === conn) this.onExit(s);
    }
  }

  private async begin(s: Session, text: string, userItem: AgentItem): Promise<string> {
    const conn = s.conn;
    if (!conn) throw new AgentError("conflict", "This session isn't running.");
    // Marked running before the provider answers, so a second send can't race
    // it into a second turn.
    s.activeTurn = "pending";
    this.update(s, { state: "running" });
    let turnId: string;
    try {
      turnId = await conn.startTurn(text);
    } catch (error) {
      s.activeTurn = undefined;
      // A process that died while starting the turn has already said so.
      if (s.conn === conn) this.update(s, { state: "idle" });
      throw error instanceof AgentError
        ? error
        : new AgentError("unavailable", error instanceof Error ? error.message : String(error));
    }
    if (s.activeTurn === "pending") s.activeTurn = turnId;
    const turn = this.ensureTurn(s, turnId);
    turn.items = [userItem, ...turn.items.filter((i) => i.id !== userItem.id)];
    this.emit({ event: "item", sessionId: s.summary.id, turnId, item: userItem });
    this.scheduleSave(s);
    return turnId;
  }

  private sinkFor(s: Session, generation: number): AgentSink {
    const id = s.summary.id;
    const live = () => s.generation === generation;
    return {
      ready: (info) => {
        if (!live()) return;
        if (info.title && !s.named) s.named = true;
        this.update(s, {
          state: s.activeTurn ? "running" : "idle",
          stateMessage: undefined,
          environment: info.environment,
          resumable: info.resumable,
          ...(info.providerSessionId ? { providerSessionId: info.providerSessionId } : {}),
          ...(info.terminalCommand ? { terminalCommand: info.terminalCommand } : {}),
          ...(info.title ? { title: info.title } : {}),
        });
      },
      history: (turns) => {
        if (!live() || s.turns.length > 0) return;
        const kept = turns.slice(-LIMITS.turns);
        s.turns = kept.map((t) => ({ ...t, items: t.items.map(boundItem) }));
        s.turnsDropped = turns.length - kept.length;
        // A session continued from outside the tab is named like one begun in it.
        const first = turns[0]?.items.find((i) => i.kind === "user");
        if (!s.named && s.summary.title === DEFAULT_TITLE && first?.kind === "user") {
          const line = first.text.trim().split("\n")[0] ?? "";
          if (line) this.update(s, { title: line.length > 60 ? `${line.slice(0, 59)}…` : line });
        }
        this.scheduleSave(s);
      },
      turnStarted: (turnId) => {
        if (!live()) return;
        if (s.activeTurn === undefined || s.activeTurn === "pending") s.activeTurn = turnId;
        this.ensureTurn(s, turnId);
        if (s.summary.state === "idle") this.update(s, { state: "running" });
      },
      item: (turnId, item) => {
        if (live()) this.putItem(s, turnId, item);
      },
      delta: (turnId, itemId, field, delta) => {
        if (!live()) return;
        const turn = this.ensureTurn(s, turnId);
        const index = turn.items.findIndex((i) => i.id === itemId);
        const item = turn.items[index];
        if (!item) return;
        if (field === "text" && "text" in item && item.kind !== "user") {
          turn.items[index] = boundItem({ ...item, text: item.text + delta });
        } else if (field === "output" && item.kind === "command") {
          const kept = tail(item.output + delta, LIMITS.output);
          turn.items[index] = {
            ...item,
            output: kept.text,
            ...(kept.dropped ? { outputDropped: (item.outputDropped ?? 0) + kept.dropped } : {}),
          };
        } else return;
        this.emit({ event: "delta", sessionId: id, turnId, itemId, field, delta });
        this.scheduleSave(s);
      },
      turnDiff: (turnId, diff) => {
        if (!live()) return;
        const turn = this.ensureTurn(s, turnId);
        turn.diff = diff.length > LIMITS.turnDiff ? diff.slice(0, LIMITS.turnDiff) : diff;
        this.emitTurn(s, turn);
      },
      turnCompleted: (turnId, status, error) => {
        if (!live()) return;
        const turn = this.ensureTurn(s, turnId);
        turn.status = status;
        turn.completedAt = new Date().toISOString();
        if (error) turn.error = error;
        // A failed turn is often a lapsed sign-in; the next look at the
        // providers should ask them again rather than repeat "ready".
        if (status === "failed") {
          this.providerCache = undefined;
          this.doubted.add(s.adapter.id);
        }
        this.emitTurn(s, turn);
        for (const request of [...s.approvals.values()]) {
          if (request.turnId === turnId) this.resolveApproval(s, request.id);
        }
        if (s.activeTurn === turnId || s.activeTurn === "pending") s.activeTurn = undefined;
        if (!s.activeTurn && s.conn) {
          this.update(s, { state: "idle" });
          void this.drainQueue(s);
        }
      },
      approval: (request) => {
        if (!live()) return;
        s.approvals.set(request.id, request);
        this.emit({ event: "approval", sessionId: id, request });
        this.update(s, { state: "awaiting-approval" });
      },
      approvalWithdrawn: (approvalId) => {
        if (live()) this.resolveApproval(s, approvalId);
      },
      controls: (controls) => {
        if (live()) this.setControls(s, controls);
      },
      titled: (title) => {
        if (!live()) return;
        s.named = true;
        this.update(s, { title });
      },
      notice: (level, text) => {
        if (!live()) return;
        const item: AgentItem = { kind: "notice", id: crypto.randomUUID(), level, text };
        if (s.activeTurn && s.activeTurn !== "pending") this.putItem(s, s.activeTurn, item);
        else {
          // Shown with the next turn; an error is also the session's state now.
          s.pendingNotices.push(item);
          if (level === "error") this.update(s, { stateMessage: text });
        }
      },
      exited: (error) => {
        if (!live() || (!s.conn && s.summary.state !== "starting")) return;
        this.onExit(s, error);
      },
    };
  }

  private onExit(s: Session, error?: string): void {
    const failed = !s.closing && error !== undefined;
    s.conn = undefined;
    if (s.activeTurn && s.activeTurn !== "pending") {
      const turn = this.ensureTurn(s, s.activeTurn);
      if (turn.status === "running") {
        turn.status = failed ? "failed" : "interrupted";
        turn.completedAt = new Date().toISOString();
        if (failed && error) turn.error = error;
        this.emitTurn(s, turn);
      }
    }
    s.activeTurn = undefined;
    for (const approvalId of [...s.approvals.keys()]) this.resolveApproval(s, approvalId);
    for (const q of s.queued) this.pending.delete(q.id);
    s.queued = [];
    this.emit({ event: "queue", sessionId: s.summary.id, queued: [] });
    if (s.controls) {
      s.controls = undefined;
      this.emit({ event: "controls", sessionId: s.summary.id, controls: null });
    }
    this.update(s, {
      state: failed ? "failed" : "exited",
      stateMessage: failed
        ? `${s.adapter.label} stopped unexpectedly: ${error}`
        : s.summary.resumable
          ? "Stopped. Reopen the session to continue it."
          : "Stopped.",
    });
  }

  private async drainQueue(s: Session): Promise<void> {
    const next = s.queued.shift();
    if (!next) return;
    this.emit({ event: "queue", sessionId: s.summary.id, queued: s.queued });
    const pending = this.pending.get(next.id);
    this.pending.delete(next.id);
    if (!pending) return;
    try {
      await this.begin(s, pending.text, pending.item);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.update(s, { stateMessage: `A queued message wasn't sent: ${message}` });
    }
  }

  private ensureTurn(s: Session, turnId: string): AgentTurn {
    let turn = s.turns.find((t) => t.id === turnId);
    if (!turn) {
      turn = { id: turnId, status: "running", items: [], startedAt: new Date().toISOString() };
      s.turns.push(turn);
      if (s.turns.length > LIMITS.turns) {
        const drop = s.turns.length - LIMITS.turns;
        s.turns.splice(0, drop);
        s.turnsDropped += drop;
      }
      this.emitTurn(s, turn);
      for (const notice of s.pendingNotices.splice(0)) this.putItem(s, turnId, notice);
    }
    return turn;
  }

  private putItem(s: Session, turnId: string, raw: AgentItem): void {
    const turn = this.ensureTurn(s, turnId);
    const item = boundItem(raw);
    const index = turn.items.findIndex((i) => i.id === item.id);
    if (index >= 0) turn.items[index] = item;
    else {
      turn.items.push(item);
      // A runaway loop keeps the prompt and the most recent work.
      if (turn.items.length > LIMITS.items) turn.items.splice(1, 1);
    }
    this.emit({ event: "item", sessionId: s.summary.id, turnId, item });
    this.scheduleSave(s);
  }

  private resolveApproval(s: Session, approvalId: string, decision?: AgentApprovalDecision): void {
    if (!s.approvals.delete(approvalId)) return;
    this.emit({
      event: "approval-resolved",
      sessionId: s.summary.id,
      approvalId,
      ...(decision ? { decision } : {}),
    });
    if (s.approvals.size === 0 && s.summary.state === "awaiting-approval") {
      this.update(s, { state: s.activeTurn ? "running" : "idle" });
    }
  }

  private update(s: Session, patch: Partial<AgentSessionSummary>): void {
    const next: AgentSessionSummary = {
      ...s.summary,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    for (const key of Object.keys(patch) as (keyof AgentSessionSummary)[]) {
      if (patch[key] === undefined) delete next[key];
    }
    s.summary = next;
    this.emit({ event: "session", session: next });
    this.scheduleSave(s);
  }

  private setControls(s: Session, controls: AgentSessionControls): void {
    s.controls = controls;
    this.emit({ event: "controls", sessionId: s.summary.id, controls });
  }

  private emitTurn(s: Session, turn: AgentTurn): void {
    const { items: _items, ...rest } = turn;
    this.emit({ event: "turn", sessionId: s.summary.id, turn: rest });
    this.scheduleSave(s);
  }

  private emit(event: AgentEvent): void {
    this.opts.broadcast({ ...event, type: AGENT_EVENT_TYPE, v: AGENT_PROTOCOL_VERSION });
  }

  private fileFor(id: string): string {
    return join(this.opts.storeDir, `${id.replace(/[^A-Za-z0-9_-]/g, "_")}.json`);
  }

  private scheduleSave(s: Session): void {
    if (s.saveTimer) return;
    s.saveTimer = setTimeout(() => {
      s.saveTimer = undefined;
      void this.save(s);
    }, 400);
  }

  private async save(s: Session): Promise<void> {
    if (!this.sessions.has(s.summary.id)) return;
    try {
      await writeJsonAtomic(this.fileFor(s.summary.id), {
        version: 1,
        session: s.summary,
        turns: s.turns,
        turnsDropped: s.turnsDropped,
      });
    } catch (error) {
      console.error("velloo: couldn't save an agent session:", error);
    }
  }
}
