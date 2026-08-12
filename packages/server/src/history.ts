import type { Page, Theme } from "@velloo/schema";

/**
 * Coarse, server-side undo history. Each persisted page or theme write pushes
 * a snapshot of the previous state. POST /api/undo pops the top entry and
 * re-persists it. Sized to keep recent edits cheap to revert without holding
 * the entire session in memory.
 */
export type HistoryEntry =
  | { kind: "page"; pageId: string; page: Page }
  | { kind: "theme"; theme: Theme };

const MAX = 50;
const stack: HistoryEntry[] = [];

export function pushHistory(entry: HistoryEntry): void {
  stack.push(entry);
  if (stack.length > MAX) stack.splice(0, stack.length - MAX);
}

export function popHistory(): HistoryEntry | undefined {
  return stack.pop();
}

export function historyDepth(): number {
  return stack.length;
}

export function clearHistory(): void {
  stack.length = 0;
}
