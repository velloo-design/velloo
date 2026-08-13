import type { DesignFolder } from "../design-folder.ts";
import type { WatchEvent } from "../watcher.ts";

export interface MutationContext {
  folder: DesignFolder;
  broadcast: (e: WatchEvent) => void;
}

/**
 * Per-page write chain. Mutations on the same page id serialize; different
 * pages run in parallel. Avoids interleaved schema-validate / write / cache
 * when canvas + MCP hit the same page concurrently.
 */
const pageChains = new Map<string, Promise<unknown>>();
const snippetChains = new Map<string, Promise<unknown>>();

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

export function withPageLock<T>(pageId: string, fn: () => Promise<T>): Promise<T> {
  return chained(pageChains, pageId, fn);
}

/** Per-snippet write chain. Mirrors withPageLock semantics. */
export function withSnippetLock<T>(snippetId: string, fn: () => Promise<T>): Promise<T> {
  return chained(snippetChains, snippetId, fn);
}
