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
  cookies?: UrlCookie[];
  localStorage?: Record<string, string>;
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
 * size is bounded by `cap`, evicting the oldest on overflow. Backs the
 * in-memory, session-scoped capture caches.
 */
export class LruMap<V> {
  private readonly entries = new Map<string, V>();
  constructor(private readonly cap: number) {}

  get(key: string): V | undefined {
    return this.entries.get(key);
  }

  set(key: string, value: V): void {
    this.entries.delete(key);
    this.entries.set(key, value);
    if (this.entries.size > this.cap) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
  }

  get size(): number {
    return this.entries.size;
  }
}
