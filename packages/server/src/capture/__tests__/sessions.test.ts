import { expect, test } from "bun:test";
import type { CaptureManifest, CaptureSessionHandle } from "@velloo/renderer";
import { type LiveSession, sessionStatuses } from "../sessions.ts";

/**
 * The reporting half of a capture session. `start_capture_session` returns
 * immediately, so without this an agent could see finished captures appear but
 * not whether the user was still in the browser at all.
 */

function manifest(id: string, url: string): CaptureManifest {
  return {
    id,
    url,
    finalUrl: url,
    title: id,
    capturedAt: new Date(0).toISOString(),
    viewport: { w: 1440, h: 900 },
    themeOnly: false,
    nodeCount: 1,
    assetCount: 0,
    files: [],
  } as unknown as CaptureManifest;
}

function fakeSession(over: {
  id?: string;
  url?: string | undefined;
  endedAt?: number | null;
  currentUrl?: () => string;
  captures?: () => CaptureManifest[];
}): LiveSession {
  const handle = {
    sessionId: over.id ?? "s1",
    currentUrl: over.currentUrl ?? (() => "https://app.test/dashboard"),
    captures: over.captures ?? (() => []),
  } as unknown as CaptureSessionHandle;
  return {
    handle,
    url: over.url,
    startedAt: 0,
    endedAt: over.endedAt ?? null,
  };
}

test("an open session reports where the user actually is, and what they've captured", () => {
  const [status] = sessionStatuses([
    fakeSession({
      url: "https://app.test/login",
      captures: () => [manifest("cap-1", "https://app.test/login")],
    }),
  ]);
  expect(status).toEqual({
    sessionId: "s1",
    status: "open",
    startedUrl: "https://app.test/login",
    currentUrl: "https://app.test/dashboard",
    openedAt: new Date(0).toISOString(),
    endedAt: null,
    captured: [{ captureId: "cap-1", url: "https://app.test/login" }],
  });
});

test("a closed session says so instead of reporting a stale current page", () => {
  const [status] = sessionStatuses([fakeSession({ url: "https://app.test/", endedAt: 60_000 })]);
  expect(status?.status).toBe("closed");
  expect(status?.currentUrl).toBeNull();
  expect(status?.endedAt).toBe(new Date(60_000).toISOString());
});

test("a handle whose window has gone degrades to nulls rather than throwing", () => {
  const boom = () => {
    throw new Error("Target page, context or browser has been closed");
  };
  const [status] = sessionStatuses([fakeSession({ currentUrl: boom, captures: boom })]);
  expect(status?.status).toBe("open");
  expect(status?.currentUrl).toBeNull();
  expect(status?.captured).toEqual([]);
});
