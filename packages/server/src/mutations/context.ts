import type { DesignFolder } from "../design-folder.ts";
import type { WatchEvent } from "../watcher.ts";

export interface MutationContext {
  folder: DesignFolder;
  broadcast: (e: WatchEvent) => void;
}

/**
 * Per-screen write chain. Mutations on the same screen id serialize; different
 * screens run in parallel. Avoids interleaved schema-validate / write / cache
 * when canvas + MCP hit the same screen concurrently.
 */
const screenChains = new Map<string, Promise<unknown>>();
const snippetChains = new Map<string, Promise<unknown>>();
let boardChain: Promise<unknown> = Promise.resolve();

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

/** Serializes all board writes — frame add/move/remove/resize, group ops. */
export function withBoardLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = boardChain.then(fn, fn);
  boardChain = next.catch(() => undefined);
  return next;
}
