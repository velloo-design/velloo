import type { DesignFolder } from "../design-folder.ts";
import type { WatchEvent } from "../watcher.ts";
import { isSnippetTreeId, snippetIdFromTreeId } from "./lookup.ts";

export interface MutationContext {
  folder: DesignFolder;
  broadcast: (e: WatchEvent) => void;
}

/**
 * Broadcast the right event for a screenId that may be either a real
 * screen or a snippet-body virtualization. Tree mutations call this
 * instead of `ctx.broadcast({ type: "screen-changed", ... })` so the
 * canvas's WS handler refreshes the correct surface.
 */
export function broadcastTreeChange(ctx: MutationContext, screenId: string): void {
  if (isSnippetTreeId(screenId)) {
    ctx.broadcast({ type: "snippet-changed", snippetId: snippetIdFromTreeId(screenId) });
  } else {
    ctx.broadcast({ type: "screen-changed", screenId });
  }
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
  // Virtualized snippet bodies (`snippet:<id>`) need to share the same
  // lock as direct snippet writes, otherwise an `update_snippet` and a
  // `update_props` against the body could interleave.
  if (isSnippetTreeId(screenId)) {
    return chained(snippetChains, snippetIdFromTreeId(screenId), fn);
  }
  return chained(screenChains, screenId, fn);
}

export function withSnippetLock<T>(snippetId: string, fn: () => Promise<T>): Promise<T> {
  return chained(snippetChains, snippetId, fn);
}

/** Serializes writes for a specific board (frame moves, group ops). */
export function withBoardLock<T>(boardId: string, fn: () => Promise<T>): Promise<T> {
  return chained(boardChains, boardId, fn);
}
