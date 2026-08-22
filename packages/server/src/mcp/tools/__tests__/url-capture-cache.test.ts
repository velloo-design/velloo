import { describe, expect, test } from "bun:test";
import type { UrlCaptureResult } from "@velloo/renderer";
import { type CachedUrlCapture, LruMap, planUrlCache, urlCacheKey } from "../url-capture-cache.ts";

const baseKey = {
  url: "http://localhost:3000/pricing",
  w: 1440,
  h: 900,
  fullPage: true,
  scale: 0.5,
  dark: false,
  storageStatePath: null,
};

function entry(capturedAt: number): CachedUrlCapture {
  // planUrlCache treats the capture opaquely — only capturedAt matters here.
  const result = { finalUrl: baseKey.url, authWall: false, pageError: null } as UrlCaptureResult;
  return { result, capturedAt };
}

describe("urlCacheKey", () => {
  test("equal inputs produce an equal key", () => {
    expect(urlCacheKey(baseKey)).toBe(urlCacheKey({ ...baseKey }));
  });

  test("each pixel-affecting input partitions the cache", () => {
    const k = urlCacheKey(baseKey);
    expect(urlCacheKey({ ...baseKey, url: `${baseKey.url}/x` })).not.toBe(k);
    expect(urlCacheKey({ ...baseKey, w: 768 })).not.toBe(k);
    expect(urlCacheKey({ ...baseKey, h: 1200 })).not.toBe(k);
    expect(urlCacheKey({ ...baseKey, fullPage: false })).not.toBe(k);
    expect(urlCacheKey({ ...baseKey, scale: 1 })).not.toBe(k);
    expect(urlCacheKey({ ...baseKey, dark: true })).not.toBe(k);
  });

  test("auth inputs partition the cache — logged-out vs logged-in are distinct", () => {
    const k = urlCacheKey(baseKey);
    expect(urlCacheKey({ ...baseKey, storageStatePath: "/tmp/state.json" })).not.toBe(k);
    expect(urlCacheKey({ ...baseKey, cookies: [{ name: "sid", value: "abc" }] })).not.toBe(k);
    expect(urlCacheKey({ ...baseKey, localStorage: { jwt: "x" } })).not.toBe(k);
  });

  test("absent and null auth normalize to the same key", () => {
    expect(urlCacheKey({ ...baseKey, cookies: undefined, localStorage: undefined })).toBe(
      urlCacheKey({ ...baseKey, cookies: null, localStorage: null }),
    );
  });
});

describe("planUrlCache", () => {
  const now = 1_000_000;
  const ttlMs = 300_000;

  test("caching off: never reuses, never stores", () => {
    const plan = planUrlCache({
      cacheUrl: false,
      refreshUrl: false,
      prior: entry(now),
      now,
      ttlMs,
    });
    expect(plan).toEqual({ active: false, reuse: null, storeEligible: false });
  });

  test("cacheUrl, no prior: fetch and store", () => {
    const plan = planUrlCache({ cacheUrl: true, refreshUrl: false, prior: undefined, now, ttlMs });
    expect(plan.active).toBe(true);
    expect(plan.reuse).toBeNull();
    expect(plan.storeEligible).toBe(true);
  });

  test("cacheUrl, fresh prior: reuse, don't re-store", () => {
    const prior = entry(now - 1000);
    const plan = planUrlCache({ cacheUrl: true, refreshUrl: false, prior, now, ttlMs });
    expect(plan.reuse).toBe(prior);
    expect(plan.storeEligible).toBe(false);
  });

  test("cacheUrl, stale prior: refetch and store", () => {
    const plan = planUrlCache({
      cacheUrl: true,
      refreshUrl: false,
      prior: entry(now - ttlMs - 1),
      now,
      ttlMs,
    });
    expect(plan.reuse).toBeNull();
    expect(plan.storeEligible).toBe(true);
  });

  test("ttl boundary is inclusive — exactly ttlMs old still reuses", () => {
    const prior = entry(now - ttlMs);
    const plan = planUrlCache({ cacheUrl: true, refreshUrl: false, prior, now, ttlMs });
    expect(plan.reuse).toBe(prior);
  });

  test("refreshUrl bypasses a fresh prior and re-freezes", () => {
    const plan = planUrlCache({
      cacheUrl: true,
      refreshUrl: true,
      prior: entry(now),
      now,
      ttlMs,
    });
    expect(plan.reuse).toBeNull();
    expect(plan.active).toBe(true);
    expect(plan.storeEligible).toBe(true);
  });

  test("refreshUrl alone (without cacheUrl) still engages and stores", () => {
    const plan = planUrlCache({ cacheUrl: false, refreshUrl: true, prior: undefined, now, ttlMs });
    expect(plan).toEqual({ active: true, reuse: null, storeEligible: true });
  });
});

describe("LruMap", () => {
  test("get/set round-trips and tracks size", () => {
    const m = new LruMap<number>(3);
    expect(m.get("a")).toBeUndefined();
    m.set("a", 1);
    expect(m.get("a")).toBe(1);
    expect(m.size).toBe(1);
  });

  test("evicts the oldest entry past the cap", () => {
    const m = new LruMap<number>(2);
    m.set("a", 1);
    m.set("b", 2);
    m.set("c", 3); // evicts "a"
    expect(m.size).toBe(2);
    expect(m.get("a")).toBeUndefined();
    expect(m.get("b")).toBe(2);
    expect(m.get("c")).toBe(3);
  });

  test("re-setting a key refreshes its recency, sparing it from eviction", () => {
    const m = new LruMap<number>(2);
    m.set("a", 1);
    m.set("b", 2);
    m.set("a", 10); // "a" is now newest
    m.set("c", 3); // evicts "b", the oldest
    expect(m.get("b")).toBeUndefined();
    expect(m.get("a")).toBe(10);
    expect(m.get("c")).toBe(3);
  });
});
