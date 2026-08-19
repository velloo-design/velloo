import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type DaemonRecord,
  daemonRoot,
  readLock,
  registryRemove,
  registryUpsert,
  removeLock,
  writeLock,
} from "../daemon/runtime.ts";

let tmp: string;
let root: string;

beforeEach(async () => {
  tmp = join(tmpdir(), `velloo-daemon-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  root = join(tmp, "design");
  await mkdir(join(root, ".design"), { recursive: true });
  process.env.VELLOO_DAEMONS_PATH = join(tmp, "daemons.json");
});

afterEach(async () => {
  delete process.env.VELLOO_DAEMONS_PATH;
  await rm(tmp, { recursive: true, force: true });
});

function rec(over: Partial<DaemonRecord> = {}): DaemonRecord {
  return {
    root,
    pid: 4242,
    canvasUrl: "http://127.0.0.1:7300",
    canvasPort: 7300,
    mcpUrl: "http://127.0.0.1:7301/mcp",
    mcpPort: 7301,
    version: "0.0.1",
    startedAt: "2026-06-18T00:00:00.000Z",
    ...over,
  };
}

describe("daemon runtime", () => {
  test("lockfile round-trips and lives under the gitignored cache dir", async () => {
    await writeLock(rec());
    // It must land under .design/cache/ (already gitignored), not loose in .design/.
    const onDisk = JSON.parse(
      await readFile(join(root, ".design", "cache", "runtime.json"), "utf8"),
    );
    expect(onDisk.canvasPort).toBe(7300);
    expect((await readLock(root))?.pid).toBe(4242);
  });

  test("removeLock clears it; readLock tolerates a missing file", async () => {
    await writeLock(rec());
    removeLock(root);
    expect(await readLock(root)).toBeNull();
  });

  test("registry upserts by root (no duplicates) and removes", async () => {
    await registryUpsert(rec());
    await registryUpsert(rec({ pid: 9999, canvasPort: 7305 })); // same root → replace
    const reg = JSON.parse(await readFile(process.env.VELLOO_DAEMONS_PATH as string, "utf8"));
    expect(reg).toHaveLength(1);
    expect(reg[0].pid).toBe(9999);

    await registryRemove(root);
    expect(JSON.parse(await readFile(process.env.VELLOO_DAEMONS_PATH as string, "utf8"))).toEqual(
      [],
    );
  });

  test("daemonRoot resolves an existing path to its realpath", () => {
    // tmp exists, so it resolves (macOS maps /var → /private/var, etc.).
    expect(daemonRoot(root)).toContain("design");
  });
});
