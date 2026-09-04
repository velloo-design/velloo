import type { StateCreator } from "zustand";
import type { CanvasState } from "./index.ts";

/**
 * Agent-activity slice: consumes the server's `activity` WS events —
 * verb, target refs, source (mcp/canvas/cli), session, timestamp — and turns
 * them into the ambient layer (indicator, node flashes, frame glows, board
 * badges) plus the feed panel's ring buffer. Canvas-originated events are
 * recorded for the feed but never produce highlights: you shouldn't be
 * flashed by your own edits.
 */

export type ActivitySource = "mcp" | "canvas" | "cli";

export interface ActivityTarget {
  screenId?: string;
  path?: number[];
  boardId?: string;
  frameId?: string;
  snippetId?: string;
  themeName?: string;
  token?: string;
  extension?: string;
  /** Boards hosting the touched screen (server-enriched — see server activity.ts). */
  boards?: string[];
}

export interface ActivityEntry {
  id: number;
  ts: number;
  verb: string;
  source: ActivitySource;
  session?: string | undefined;
  target: ActivityTarget;
  /** Grouped bursts (batch): per-op detail, capped server-side. */
  ops?: Array<{ verb: string; target: ActivityTarget }>;
  opCount?: number | undefined;
}

/** Client-side ring cap — the feed shows at most this many entries. */
const FEED_CAP = 200;

export interface ActivitySlice {
  /** Recent events, oldest first, bounded at FEED_CAP. */
  activityEvents: ActivityEntry[];
  activityFeedOpen: boolean;
  /** Last time a non-canvas (agent) event arrived — drives the indicator pulse. */
  lastAgentActivityAt: number | null;
  /**
   * Per-screen flash request for frames showing it. `path` is the node to
   * flash (dotted), null = screen-level (frame glow instead). The nonce
   * coalesces bursts: frames reset their clear-timer per bump, so a rapid
   * stream reads as one sustained pulse, not a strobe.
   */
  activityFlash: Record<string, { nonce: number; path: string | null }>;
  /** frameId → nonce: frame-level glow cue (screen/frame/theme-level ops). */
  frameGlow: Record<string, number>;
  /** boardId → ts of activity on a non-visible board (board-switcher badge). */
  boardPulse: Record<string, number>;

  recordActivity(e: ActivityEntry): void;
  /** Merge the server's /api/activity backlog under live WS entries. */
  backfillActivity(): Promise<void>;
  setActivityFeedOpen(open: boolean): void;
}

/** Loosely validate a WS payload into an ActivityEntry (trust boundary). */
export function parseActivityEntry(raw: unknown): ActivityEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;
  if (typeof e.id !== "number" || typeof e.ts !== "number" || typeof e.verb !== "string") {
    return null;
  }
  if (e.source !== "mcp" && e.source !== "canvas" && e.source !== "cli") return null;
  if (!e.target || typeof e.target !== "object") return null;
  return raw as ActivityEntry;
}

export const createActivitySlice: StateCreator<CanvasState, [], [], ActivitySlice> = (
  set,
  get,
) => ({
  activityEvents: [],
  activityFeedOpen: false,
  lastAgentActivityAt: null,
  activityFlash: {},
  frameGlow: {},
  boardPulse: {},

  recordActivity(e) {
    set((s) => {
      const activityEvents =
        s.activityEvents.length >= FEED_CAP
          ? [...s.activityEvents.slice(-(FEED_CAP - 1)), e]
          : [...s.activityEvents, e];
      return { activityEvents };
    });
    if (e.source === "canvas") return; // never self-flash (AC#5)

    const state = get();
    const flash: Record<string, { nonce: number; path: string | null }> = {
      ...state.activityFlash,
    };
    const glow: Record<string, number> = { ...state.frameGlow };
    const pulse: Record<string, number> = { ...state.boardPulse };
    const currentBoard = state.currentBoardId ? state.boards[state.currentBoardId] : null;

    const cueFor = (target: ActivityTarget) => {
      // Node-level: flash the touched node in every frame showing the screen.
      if (target.screenId && target.path) {
        const prev = flash[target.screenId];
        flash[target.screenId] = { nonce: (prev?.nonce ?? 0) + 1, path: target.path.join(".") };
      } else if (target.screenId) {
        // Screen-level: glow the hosting frames on the visible board.
        for (const f of currentBoard?.frames ?? []) {
          if (f.screen === target.screenId) glow[f.id] = (glow[f.id] ?? 0) + 1;
        }
      }
      if (target.frameId) glow[target.frameId] = (glow[target.frameId] ?? 0) + 1;
      // Theme-level: everything on the visible board re-renders — glow it all.
      if (target.themeName !== undefined || target.token !== undefined) {
        for (const f of currentBoard?.frames ?? []) glow[f.id] = (glow[f.id] ?? 0) + 1;
      }
      // Board badge for activity elsewhere: explicit boardId, the server's
      // enriched hosting-board list, plus any loaded board with the screen.
      const boardIds = new Set<string>(target.boards ?? []);
      if (target.boardId) boardIds.add(target.boardId);
      if (target.screenId) {
        for (const b of Object.values(state.boards)) {
          if (b.frames.some((f) => f.screen === target.screenId)) boardIds.add(b.id);
        }
      }
      for (const id of boardIds) {
        if (id !== state.currentBoardId) pulse[id] = e.ts;
      }
    };

    cueFor(e.target);
    for (const op of e.ops ?? []) cueFor(op.target);

    set({
      lastAgentActivityAt: Date.now(),
      activityFlash: flash,
      frameGlow: glow,
      boardPulse: pulse,
    });
  },

  async backfillActivity() {
    try {
      const res = await fetch("/api/activity");
      if (!res.ok) return;
      const body = (await res.json()) as { events?: unknown[] };
      const incoming = (body.events ?? [])
        .map(parseActivityEntry)
        .filter((entry): entry is ActivityEntry => entry !== null);
      set((s) => {
        const seen = new Set(s.activityEvents.map((entry) => entry.id));
        const merged = [...incoming.filter((entry) => !seen.has(entry.id)), ...s.activityEvents]
          .sort((a, b) => a.id - b.id)
          .slice(-FEED_CAP);
        return { activityEvents: merged };
      });
    } catch {
      // Backfill is best-effort; live WS entries still flow.
    }
  },

  setActivityFeedOpen(activityFeedOpen) {
    set({ activityFeedOpen });
    if (activityFeedOpen) void get().backfillActivity();
  },
});
