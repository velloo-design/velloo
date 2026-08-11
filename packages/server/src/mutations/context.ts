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

export function withPageLock<T>(pageId: string, fn: () => Promise<T>): Promise<T> {
  const prev = pageChains.get(pageId) ?? Promise.resolve();
  const next = prev.then(fn, fn); // run fn even if the previous task threw
  // Track this task for the chain. Catch its rejection so the chain itself
  // doesn't leak unhandled-rejection signals.
  pageChains.set(
    pageId,
    next.catch(() => undefined),
  );
  return next;
}
