import type { ComponentProvider } from "@velloo/provider";
import type { DesignFolder } from "../design-folder.ts";
import { createLockMap } from "../locks.ts";
import type { WatchEvent } from "../watcher.ts";
import { isSnippetTreeId, snippetIdFromTreeId } from "./lookup.ts";

/**
 * Per-design-folder server state. Multi-library: every
 * library registered in `folder.config.libraries` resolves to a
 * provider in `providers` keyed by the same id; `defaultProvider`
 * is `providers[folder.config.defaultLibrary]` for fast access.
 */
export interface MutationContext {
  folder: DesignFolder;
  /**
   * One provider per registered library, keyed by `libraryId`. A
   * screen with `library: "marketing"` resolves through
   * `providers["marketing"]`.
   */
  providers: Record<string, ComponentProvider>;
  /** Provider used when a screen / snippet doesn't declare a `library`. */
  defaultProvider: ComponentProvider;
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

const locks = createLockMap();

/** Only `root` is read — a stable folder identity that survives folder reloads. */
export type LockFolder = Pick<DesignFolder, "root">;

// Keys carry the folder root + a resource kind so two design folders served
// by one daemon never contend, and a screen/board sharing an id never collide.
// NUL separators can't appear in a path or resource id.
const lockKey = (folder: LockFolder, kind: "screen" | "snippet" | "board", id: string) =>
  `${folder.root}\u0000${kind}\u0000${id}`;

export function withScreenLock<T>(
  folder: LockFolder,
  screenId: string,
  fn: () => Promise<T>,
): Promise<T> {
  // Virtualized snippet bodies (`snippet:<id>`) need to share the same
  // lock as direct snippet writes, otherwise an `update_snippet` and a
  // `update_props` against the body could interleave.
  if (isSnippetTreeId(screenId)) {
    return locks.run(lockKey(folder, "snippet", snippetIdFromTreeId(screenId)), fn);
  }
  return locks.run(lockKey(folder, "screen", screenId), fn);
}

export function withSnippetLock<T>(
  folder: LockFolder,
  snippetId: string,
  fn: () => Promise<T>,
): Promise<T> {
  return locks.run(lockKey(folder, "snippet", snippetId), fn);
}

/** Serializes writes for a specific board (frame moves, group ops). */
export function withBoardLock<T>(
  folder: LockFolder,
  boardId: string,
  fn: () => Promise<T>,
): Promise<T> {
  return locks.run(lockKey(folder, "board", boardId), fn);
}
