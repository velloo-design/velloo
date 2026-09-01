import { AsyncLocalStorage } from "node:async_hooks";
import type { Result } from "@velloo/result";
import { isArchived } from "@velloo/schema";

/**
 * Agent-activity events. Every mutation api wrapper emits one
 * `activity` event on success — verb, target refs, source, session, timestamp
 * — riding the same one-way WS channel as WatchEvents. Presentation-only
 * metadata: the WatchEvent contract is untouched and stays the refresh
 * mechanism; a client that doesn't know the `activity` type ignores it (the
 * canvas dispatch is an if/else-if chain that falls through unknown types).
 *
 * Grouped shape (documented per AC#2): `batch` collects the events its inner
 * calls would emit and publishes ONE event with `verb: "batch"`, per-op detail
 * in `ops` (capped at GROUP_DETAIL_CAP entries) and the true size in
 * `opCount`; an atomic batch that rolled back publishes nothing.
 * `set_screen_tree` replaces a whole tree, so it is inherently one event with
 * a screen-level target — never a per-node flood.
 *
 * The server keeps a bounded per-folder ring buffer (ACTIVITY_LOG_CAP) served
 * at GET /api/activity so a freshly opened canvas can backfill. In-memory
 * only — the durable audit trail is the trace recorder's job (VELLOO_TRACE).
 */

export type ActivitySource = "mcp" | "canvas" | "cli";

export interface ActivityTarget {
  screenId?: string;
  /** Resolved numeric node path (from the mutation result) when node-level. */
  path?: number[];
  boardId?: string;
  frameId?: string;
  snippetId?: string;
  /** Theme-level ops: the named theme touched (default when omitted). */
  themeName?: string;
  /** Theme token path, e.g. "colors.primary". */
  token?: string;
  extension?: string;
  /**
   * Boards hosting the touched screen, enriched at emit time — the canvas
   * only holds frames for boards it has loaded, so it can't derive this for
   * a board it hasn't opened (the board-switcher badge needs it).
   */
  boards?: string[];
}

export interface ActivityOp {
  verb: string;
  target: ActivityTarget;
}

export interface ActivityEvent {
  type: "activity";
  /** Monotonic per-daemon id — lets a client dedupe backfill vs live WS. */
  id: number;
  /** Epoch ms. */
  ts: number;
  verb: string;
  source: ActivitySource;
  /** MCP session id when the mutation came from an agent. */
  session?: string;
  target: ActivityTarget;
  /** Grouped bursts only: per-op detail, capped at GROUP_DETAIL_CAP. */
  ops?: ActivityOp[];
  /** Grouped bursts only: the true number of ops (may exceed ops.length). */
  opCount?: number;
}

export const ACTIVITY_LOG_CAP = 250;
export const GROUP_DETAIL_CAP = 20;

/**
 * The slice of a MutationContext / ThemeContext the emitter needs — folder
 * identity for the ring buffer, broadcast for the WS fan-out.
 */
export interface ActivityContext {
  folder: {
    root: string;
    boards?: Map<string, { id: string; archivedAt?: string; frames: Array<{ screen: string }> }>;
  };
  broadcast: (e: ActivityEvent) => void;
}

interface Actor {
  source: ActivitySource;
  session?: string | undefined;
}

// Source attribution rides AsyncLocalStorage so the mutation wrappers never
// need a threaded actor param: the MCP HTTP handler and the canvas route
// helper set it at their boundaries; anything else (direct library use, the
// CLI) defaults to "cli".
const actorStorage = new AsyncLocalStorage<Actor>();

export function withActor<T>(actor: Actor, fn: () => T): T {
  return actorStorage.run(actor, fn);
}

// Grouping scope: while active, emissions collect instead of publishing.
const groupStorage = new AsyncLocalStorage<ActivityOp[]>();

/** Run `fn` collecting the activity its inner mutations would emit. */
export async function collectActivity<T>(
  fn: () => Promise<T>,
): Promise<{ value: T; ops: ActivityOp[] }> {
  const ops: ActivityOp[] = [];
  const value = await groupStorage.run(ops, fn);
  return { value, ops };
}

/** Publish one grouped event for a collected burst (see the module doc). */
export function emitGroupedActivity(ctx: ActivityContext, verb: string, ops: ActivityOp[]): void {
  if (ops.length === 0) return;
  const first = ops[0] as ActivityOp;
  publish(ctx, verb, first.target, {
    // Ops were collected before publish-time enrichment — enrich them here.
    ops: ops
      .slice(0, GROUP_DETAIL_CAP)
      .map((op) => ({ ...op, target: enrichBoards(ctx, op.target) })),
    opCount: ops.length,
  });
}

/** Emit an activity event (or collect it inside a grouping scope). */
export function emitActivity(ctx: ActivityContext, verb: string, target: ActivityTarget): void {
  const group = groupStorage.getStore();
  if (group) {
    group.push({ verb, target });
    return;
  }
  publish(ctx, verb, target, {});
}

/**
 * Wrap a mutation wrapper body: run it, and on ok emit `verb` with the
 * target (computed from the result when a function — mutation results carry
 * resolved numeric paths, which the canvas needs for node highlights).
 * Failures emit nothing.
 */
export async function tracked<T, E>(
  ctx: ActivityContext,
  verb: string,
  target: ActivityTarget | ((value: T) => ActivityTarget),
  run: () => Promise<Result<T, E>>,
): Promise<Result<T, E>> {
  const result = await run();
  if (result.ok) {
    emitActivity(
      ctx,
      verb,
      typeof target === "function"
        ? (target as (value: T) => ActivityTarget)(result.value)
        : target,
    );
  }
  return result;
}

// ---- ring buffer -----------------------------------------------------------

const logs = new Map<string, ActivityEvent[]>();
let nextId = 1;

/** The folder's recent activity, oldest first (bounded at ACTIVITY_LOG_CAP). */
export function activityLog(folderRoot: string): ActivityEvent[] {
  return logs.get(folderRoot) ?? [];
}

/** Test hook: drop a folder's log so suites don't see each other's events. */
export function clearActivityLogForTest(folderRoot: string): void {
  logs.delete(folderRoot);
}

/** See ActivityTarget.boards — resolved here because only the server knows every board. */
function enrichBoards(ctx: ActivityContext, target: ActivityTarget): ActivityTarget {
  if (!target.screenId || target.boardId || !ctx.folder.boards) return target;
  const hosting = [...ctx.folder.boards.values()].filter((b) =>
    b.frames.some((f) => f.screen === target.screenId),
  );
  // Point the feed at a board the user can actually see; an archived host
  // is better than nothing when it's the only one left.
  const live = hosting.filter((b) => !isArchived(b));
  const boards = (live.length > 0 ? live : hosting).map((b) => b.id);
  return boards.length > 0 ? { ...target, boards } : target;
}

function publish(
  ctx: ActivityContext,
  verb: string,
  target: ActivityTarget,
  extra: Pick<ActivityEvent, "ops" | "opCount"> | Record<string, never>,
): void {
  const actor = actorStorage.getStore();
  const event: ActivityEvent = {
    type: "activity",
    id: nextId++,
    ts: Date.now(),
    verb,
    source: actor?.source ?? "cli",
    ...(actor?.session ? { session: actor.session } : {}),
    target: enrichBoards(ctx, target),
    ...extra,
  };
  const root = ctx.folder.root;
  const log = logs.get(root) ?? [];
  log.push(event);
  if (log.length > ACTIVITY_LOG_CAP) log.splice(0, log.length - ACTIVITY_LOG_CAP);
  logs.set(root, log);
  ctx.broadcast(event);
}
