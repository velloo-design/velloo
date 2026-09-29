import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostSession } from "../host-session.ts";

let dir: string | undefined;
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("HostSession", () => {
  test("expires cookies by Max-Age or Expires, and forgets cleared ones", () => {
    const session = new HostSession();
    const now = Date.parse("2026-09-29T00:00:00Z");
    session.absorb(
      [
        "a=1; Max-Age=60; HttpOnly",
        "b=2; Expires=Tue, 29 Sep 2026 00:00:30 GMT",
        "c=3; Path=/",
        "=nameless",
      ],
      now,
    );
    expect(session.header(now)).toBe("a=1; b=2; c=3");
    expect(session.header(now + 45_000)).toBe("a=1; c=3");
    // A refreshed value is kept but isn't a sign-in.
    expect(session.absorb(["c=4; Path=/"], now)).toBe(false);
    expect(session.header(now)).toBe("a=1; b=2; c=4");
    expect(session.absorb(["c=; Max-Age=0"], now)).toBe(true);
    expect(session.header(now)).toBe("a=1; b=2");
    expect(session.absorb(["gone=; Max-Age=0"], now)).toBe(false);
  });

  test("a design's session survives a restart, outside the design, readable only by its owner", async () => {
    dir = await mkdtemp(join(tmpdir(), "velloo-session-"));
    const home = join(dir, "home");
    const before = process.env.VELLOO_HOME;
    process.env.VELLOO_HOME = home;
    try {
      const folder = join(dir, "design");
      HostSession.forFolder(folder, "http://127.0.0.1:8085", "f1").absorb(["session=abc"]);
      expect(HostSession.forFolder(folder, "http://127.0.0.1:8085", "f1").header()).toBe(
        "session=abc",
      );
      // Another app has its own jar.
      expect(HostSession.forFolder(folder, "http://127.0.0.1:9000", "f1").header()).toBeUndefined();
      const files = await readdir(join(home, "sessions", "f1"));
      expect(files).toHaveLength(1);
      expect(await readdir(dir)).not.toContain("design");
      const file = join(home, "sessions", "f1", files[0] as string);
      if (process.platform !== "win32") expect((await stat(file)).mode & 0o777).toBe(0o600);
    } finally {
      if (before === undefined) delete process.env.VELLOO_HOME;
      else process.env.VELLOO_HOME = before;
    }
  });
});
