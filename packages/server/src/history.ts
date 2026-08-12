import type { Page, Theme } from "@velloo/schema";

/**
 * Coarse, server-side undo / redo history. Each persisted page or theme write
 * pushes a snapshot of the previous state onto the undo stack and clears the
 * redo stack. POST /api/undo pops undo → pushes the *current* state to redo →
 * re-persists. POST /api/redo runs the inverse. Sized to keep recent edits
 * cheap to revert without holding the whole session in memory.
 */
export type HistoryEntry =
  | { kind: "page"; pageId: string; page: Page }
  | { kind: "theme"; theme: Theme };

const MAX = 50;
const undoStack: HistoryEntry[] = [];
const redoStack: HistoryEntry[] = [];

/** Push a snapshot of the *previous* state before a write. Clears redo. */
export function pushHistory(entry: HistoryEntry): void {
  undoStack.push(entry);
  if (undoStack.length > MAX) undoStack.splice(0, undoStack.length - MAX);
  redoStack.length = 0;
}

/** Push a snapshot specifically onto the redo stack (used by undo). */
export function pushRedo(entry: HistoryEntry): void {
  redoStack.push(entry);
  if (redoStack.length > MAX) redoStack.splice(0, redoStack.length - MAX);
}

/** Push a snapshot specifically onto the undo stack (used by redo). */
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
