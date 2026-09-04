import type { UrlCaptureResult, UrlCookie } from "@velloo/renderer";

/** A URL capture frozen at a point in time, for cross-call reuse. */
export interface CachedUrlCapture {
  result: UrlCaptureResult;
  capturedAt: number;
}

/** Inputs that change what a URL capture looks like — the cache partition. */
export interface UrlCacheKeyParams {
  url: string;
  w: number;
  h: number;
  fullPage: boolean;
  scale: number;
  dark: boolean;
  /** Resolved absolute path, or null when no storage state. */
  storageStatePath: string | null;
  cookies?: UrlCookie[] | undefined;
  localStorage?: Record<string, string> | undefined;
}

/**
 * Stable cache key over every input that affects the captured pixels. Auth
 * inputs are part of it because they change *which* page lands — a logged-out
 * capture and a logged-in one are different references.
 */
export function urlCacheKey(p: UrlCacheKeyParams): string {
  return JSON.stringify({
    url: p.url,
    w: p.w,
    h: p.h,
    fullPage: p.fullPage,
    scale: p.scale,
    dark: p.dark,
    storageStatePath: p.storageStatePath,
    cookies: p.cookies ?? null,
    localStorage: p.localStorage ?? null,
  });
}

export interface UrlCachePlan {
  /** Caching is engaged at all (cacheUrl or refreshUrl was set). */
  active: boolean;
  /** A fresh prior capture to reuse instead of fetching, or null to fetch. */
  reuse: CachedUrlCapture | null;
  /** A freshly-fetched capture should be frozen — gate on verified-ness too. */
  storeEligible: boolean;
}

/**
 * Decide, before fetching, whether to reuse a frozen capture and whether a
 * fresh one is eligible to be stored. `refreshUrl` forces a refetch (bypasses
 * the read) but still re-freezes; `cacheUrl` alone reuses a prior within
 * `ttlMs`. Whether a *bad* capture is actually stored is the caller's gate —
 * unverified-ness isn't known until after the fetch.
 */
export function planUrlCache(opts: {
  cacheUrl: boolean;
  refreshUrl: boolean;
  prior: CachedUrlCapture | undefined;
  now: number;
  ttlMs: number;
}): UrlCachePlan {
  const { cacheUrl, refreshUrl, prior, now, ttlMs } = opts;
  const active = cacheUrl || refreshUrl;
  const reuse = cacheUrl && !refreshUrl && prior && now - prior.capturedAt <= ttlMs ? prior : null;
  return { active, reuse, storeEligible: active && reuse === null };
}

/**
 * A least-recently-used map: inserting (or re-inserting) a key marks it newest;
 * size is bounded by `cap` (entry count) and, optionally, by a total byte
 * budget when a `sizeOf` is supplied — evicting the oldest until both hold.
 * Backs the in-memory, session-scoped capture caches, whose values are multi-MB
 * PNG buffers, so a count cap alone leaves memory unbounded at scale.
 */
export class LruMap<V> {
  private readonly entries = new Map<string, V>();
  private bytes = 0;
  private readonly maxBytes: number | undefined;
  private readonly sizeOf: (v: V) => number;

  constructor(
    private readonly cap: number,
    opts: { maxBytes?: number; sizeOf?: (v: V) => number } = {},
  ) {
    this.maxBytes = opts.maxBytes;
    this.sizeOf = opts.sizeOf ?? (() => 0);
  }

  get(key: string): V | undefined {
    return this.entries.get(key);
  }

  set(key: string, value: V): void {
    const prev = this.entries.get(key);
    if (prev !== undefined) this.bytes -= this.sizeOf(prev);
    this.entries.delete(key);
    this.entries.set(key, value);
    this.bytes += this.sizeOf(value);
    // Evict oldest until within both the count cap and the byte budget (keep
    // at least the just-inserted entry even if it alone exceeds the budget).
    while (
      this.entries.size > this.cap ||
      (this.maxBytes !== undefined && this.bytes > this.maxBytes && this.entries.size > 1)
    ) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      const v = this.entries.get(oldest);
      if (v !== undefined) this.bytes -= this.sizeOf(v);
      this.entries.delete(oldest);
    }
  }

  get size(): number {
    return this.entries.size;
  }
}
