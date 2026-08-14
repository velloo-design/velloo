import type { DesignFolder } from "../design-folder.ts";
import type { WatchEvent } from "../watcher.ts";

export interface MutationContext {
  folder: DesignFolder;
  broadcast: (e: WatchEvent) => void;
}

const screenChains = new Map<string, Promise<unknown>>();
const snippetChains = new Map<string, Promise<unknown>>();
const boardChains = new Map<string, Promise<unknown>>();

function chained<T>(
  chains: Map<string, Promise<unknown>>,
  key: string,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = chains.get(key) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  chains.set(
    key,
    next.catch(() => undefined),
  );
  return next;
}

export function withScreenLock<T>(screenId: string, fn: () => Promise<T>): Promise<T> {
  return chained(screenChains, screenId, fn);
}

export function withSnippetLock<T>(snippetId: string, fn: () => Promise<T>): Promise<T> {
  return chained(snippetChains, snippetId, fn);
}

/** Serializes writes for a specific board (frame moves, group ops). */
export function withBoardLock<T>(boardId: string, fn: () => Promise<T>): Promise<T> {
  return chained(boardChains, boardId, fn);
}
