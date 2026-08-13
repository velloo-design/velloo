import type { Board, Screen, Snippet, Theme } from "@velloo/schema";

/**
 * Coarse, server-side undo / redo history. Each persisted screen, board, theme,
 * or snippet write pushes a snapshot of the previous state onto the undo stack
 * and clears the redo stack. POST /api/undo pops undo → pushes the *current*
 * state to redo → re-persists. POST /api/redo runs the inverse.
 *
 * Consecutive writes within COALESCE_WINDOW_MS that target the same key
 * collapse into the *first* entry — so a stream of live edits (e.g. dragging
 * a frame on the board) produces a single undo step, not one per pixel.
 */
export type HistoryEntry =
  | { kind: "screen"; screenId: string; screen: Screen | null; ts?: number }
  | { kind: "board"; board: Board; ts?: number }
  | { kind: "theme"; theme: Theme; ts?: number }
  | { kind: "snippet"; snippetId: string; snippet: Snippet | null; ts?: number };

const MAX = 50;
const COALESCE_WINDOW_MS = 800;
const undoStack: HistoryEntry[] = [];
const redoStack: HistoryEntry[] = [];

function keyOf(e: HistoryEntry): string {
  if (e.kind === "screen") return `screen:${e.screenId}`;
  if (e.kind === "board") return "board";
  if (e.kind === "snippet") return `snippet:${e.snippetId}`;
  return "theme";
}

/** Push a snapshot of the *previous* state before a write. Clears redo. */
export function pushHistory(entry: HistoryEntry): void {
  const stamped: HistoryEntry = { ...entry, ts: Date.now() };
  const top = undoStack[undoStack.length - 1];
  if (top?.ts && stamped.ts && stamped.ts - top.ts < COALESCE_WINDOW_MS) {
    if (keyOf(top) === keyOf(stamped)) {
      top.ts = stamped.ts;
      redoStack.length = 0;
      return;
    }
  }
  undoStack.push(stamped);
  if (undoStack.length > MAX) undoStack.splice(0, undoStack.length - MAX);
  redoStack.length = 0;
}

export function pushRedo(entry: HistoryEntry): void {
  redoStack.push(entry);
  if (redoStack.length > MAX) redoStack.splice(0, redoStack.length - MAX);
}

export function pushUndoSilent(entry: HistoryEntry): void {
  undoStack.push(entry);
  if (undoStack.length > MAX) undoStack.splice(0, undoStack.length - MAX);
}

export function popUndo(): HistoryEntry | undefined {
  return undoStack.pop();
}

export function popRedo(): HistoryEntry | undefined {
  return redoStack.pop();
}

export function historyDepths(): { undo: number; redo: number } {
  return { undo: undoStack.length, redo: redoStack.length };
}

export function clearHistory(): void {
  undoStack.length = 0;
  redoStack.length = 0;
}
