import type { Board, Screen, Snippet, Theme } from "@velloo/schema";

/**
 * Coarse, server-side undo / redo history. Each persisted screen, board, theme,
 * or snippet write pushes a snapshot of the previous state onto the undo stack
 * and clears the redo stack. POST /api/undo pops undo → pushes the *current*
 * state to redo → re-persists.
 *
 * Consecutive writes within COALESCE_WINDOW_MS that target the same key
 * collapse into the first entry — so a stream of live edits (frame drag,
 * resize) becomes one undo step instead of one per pixel.
 *
 * A write may also name the gesture it belongs to, which merges without any
 * time limit: a scrub the user pauses mid-drag to look at is still one act,
 * and only the client knows when the pointer went down and up.
 *
 * One instance per design folder (carried on `DesignFolder.history`) so
 * parallel folders — and tests — never share stacks.
 */
export type HistoryEntry =
  | {
      kind: "screen";
      screenId: string;
      screen: Screen | null;
      coalesceKey?: string | undefined;
      ts?: number | undefined;
    }
  | { kind: "board"; boardId: string; board: Board | null; ts?: number }
  /**
   * Several boards written as one act — a frame moved between two of them.
   * Undo has to put both back together: reverting half a move would leave the
   * frame duplicated or gone, neither of which is a state the user was ever in.
   * Snapshots are in write order.
   */
  | { kind: "boards"; boards: Array<{ boardId: string; board: Board | null }>; ts?: number }
  | {
      kind: "theme";
      themeName: string;
      theme: Theme | null;
      /**
       * What this write adjusted, e.g. `token:colors.primary` or
       * `typeset:default:leading`. Present only for edits that stream — a
       * dragged control writes many times and should collapse to one step.
       * Absent means the write was a discrete act (a preset applied, a palette
       * derived) and gets an undo step of its own.
       */
      coalesceKey?: string;
      ts?: number;
    }
  | {
      kind: "snippet";
      snippetId: string;
      snippet: Snippet | null;
      coalesceKey?: string | undefined;
      ts?: number;
    };

const MAX = 50;
const COALESCE_WINDOW_MS = 800;

/** The identity two consecutive writes must share to merge. Null never merges. */
function keyOf(e: HistoryEntry): string | null {
  if (e.kind === "screen") return `screen:${e.screenId}${suffix(e.coalesceKey)}`;
  if (e.kind === "board") return `board:${e.boardId}`;
  // A multi-board write is a discrete act, never a streamed one — nothing to
  // collapse, and merging it into a neighbouring single-board entry would drop
  // one of its snapshots.
  if (e.kind === "boards") return null;
  if (e.kind === "snippet") return `snippet:${e.snippetId}${suffix(e.coalesceKey)}`;
  if (!e.coalesceKey) return null;
  // Scoped by name as well as control: merging two different theme files into
  // one entry would restore whichever the entry happens to name and silently
  // strand the other's edit.
  return `theme:${e.themeName}:${e.coalesceKey}`;
}

function suffix(coalesceKey: string | undefined): string {
  return coalesceKey ? `:${coalesceKey}` : "";
}

export class HistoryManager {
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];

  /** Push a snapshot of the *previous* state before a write. Clears redo. */
  push(entry: HistoryEntry): void {
    const stamped: HistoryEntry = { ...entry, ts: Date.now() };
    const top = this.undoStack[this.undoStack.length - 1];
    const key = keyOf(stamped);
    // A named gesture is bounded by the client's pointer, not by a clock, so
    // it merges however long the user holds the drag still.
    const named = "coalesceKey" in entry && entry.coalesceKey !== undefined;
    const inWindow =
      top?.ts !== undefined && stamped.ts !== undefined && stamped.ts - top.ts < COALESCE_WINDOW_MS;
    if (key !== null && top !== undefined && (named || inWindow)) {
      if (keyOf(top) === key) {
        top.ts = stamped.ts;
        this.redoStack.length = 0;
        return;
      }
    }
    this.undoStack.push(stamped);
    if (this.undoStack.length > MAX) this.undoStack.splice(0, this.undoStack.length - MAX);
    this.redoStack.length = 0;
  }

  pushRedo(entry: HistoryEntry): void {
    this.redoStack.push(entry);
    if (this.redoStack.length > MAX) this.redoStack.splice(0, this.redoStack.length - MAX);
  }

  /** Push to undo without clearing redo — used when applying a redo. */
  pushUndoSilent(entry: HistoryEntry): void {
    this.undoStack.push(entry);
    if (this.undoStack.length > MAX) this.undoStack.splice(0, this.undoStack.length - MAX);
  }

  popUndo(): HistoryEntry | undefined {
    return this.undoStack.pop();
  }

  popRedo(): HistoryEntry | undefined {
    return this.redoStack.pop();
  }

  depths(): { undo: number; redo: number } {
    return { undo: this.undoStack.length, redo: this.redoStack.length };
  }

  /**
   * Discard undo entries above `undoDepth` — used by transactional
   * batch rollback so reverted mutations don't pollute the user's undo.
   * (Redo cleared by those pushes is not restored; same loss any write
   * causes today.)
   */
  truncateUndoTo(undoDepth: number): void {
    while (this.undoStack.length > undoDepth) this.undoStack.pop();
  }

  /**
   * Drop both stacks — after an out-of-band rewrite of the folder (git
   * revert-all) every snapshot references state that no longer exists.
   */
  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }
}
