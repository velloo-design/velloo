/**
 * Keyed promise-chain locks: `run` serializes callers per key, distinct keys
 * run in parallel. Backs the per-screen/-snippet/-board mutation locks and
 * the per-folder theme lock — callers key by `folder.root` + id so two design
 * folders served by one daemon never contend on a lock.
 */
export interface LockMap {
  run<T>(key: string, fn: () => Promise<T>): Promise<T>;
  /** Live (non-drained) chain count — for tests asserting eviction. */
  readonly size: number;
}

export function createLockMap(): LockMap {
  const chains = new Map<string, Promise<unknown>>();
  return {
    run<T>(key: string, fn: () => Promise<T>): Promise<T> {
      const prev = chains.get(key) ?? Promise.resolve();
      const next = prev.then(fn, fn);
      // The stored tail swallows rejections so one failure doesn't poison the chain.
      const tail = next.then(
        () => undefined,
        () => undefined,
      );
      chains.set(key, tail);
      // Evict a drained chain (nobody queued behind this tail) so the map
      // doesn't accumulate an entry per id ever touched over daemon lifetime.
      void tail.then(() => {
        if (chains.get(key) === tail) chains.delete(key);
      });
      return next;
    },
    get size() {
      return chains.size;
    },
  };
}
