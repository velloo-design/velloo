import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CURRENT_SCHEMA_VERSION } from "@velloo/schema";
import {
  assertFolderFormatCurrent,
  type DaemonRecord,
  DEFAULT_CANVAS_PORT,
  DesignFolderFormatError,
  daemonMatchesRuntime,
  daemonRoot,
  derivedPort,
  ensureDaemon,
  portCandidates,
  readLock,
  readRememberedPort,
  registryRemove,
  registryUpsert,
  rememberPort,
  removeLock,
  writeLock,
} from "../daemon/runtime.ts";
import { TOOL_VERSION } from "../version.ts";

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
    cloudUrl: "http://localhost:7400",
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

  test("daemon reuse requires both the current version and cloud target", () => {
    const current = rec({ version: TOOL_VERSION });
    expect(daemonMatchesRuntime(current, "http://localhost:7400")).toBe(true);
    expect(daemonMatchesRuntime(current, "https://api.dev.velloo.ai")).toBe(false);
    expect(daemonMatchesRuntime(rec({ version: "older" }), "http://localhost:7400")).toBe(false);

    // Records written before cloudUrl was added must restart once so they pick
    // up the active target instead of silently retaining an unknown one.
    const legacy = { ...current } as Partial<DaemonRecord>;
    delete legacy.cloudUrl;
    expect(daemonMatchesRuntime(legacy as DaemonRecord, "http://localhost:7400")).toBe(false);
  });
});

/**
 * A canvas tab points at a port, not at a folder, so a folder that comes back
 * on a different port strands every tab left open on it — and takes the
 * per-origin canvas prefs (last board, per-board zoom) with it.
 */
describe("port stickiness", () => {
  test("the port memo round-trips and outlives the lockfile", async () => {
    await rememberPort(root, 7318);
    await writeLock(rec({ canvasPort: 7318 }));
    // Stopping clears "running"; it must not clear "where this folder runs".
    removeLock(root);
    expect(await readRememberedPort(root)).toBe(7318);
  });

  test("a missing or corrupt memo reads as no memory", async () => {
    expect(await readRememberedPort(root)).toBeNull();
    await mkdir(join(root, ".design", "cache"), { recursive: true });
    await writeFile(join(root, ".design", "cache", "port.json"), "{ not json");
    expect(await readRememberedPort(root)).toBeNull();
    await writeFile(join(root, ".design", "cache", "port.json"), JSON.stringify({ canvasPort: 0 }));
    expect(await readRememberedPort(root)).toBeNull();
  });

  // 7305 rather than a port inside the derived band: `root` is a random temp
  // path, so any in-band literal is one hash away from being this folder's own
  // derived port, and the candidate list would dedupe it back out.
  test("a remembered port is asked for before the default", () => {
    expect(portCandidates({ remembered: 7305, root })).toEqual([
      7305,
      DEFAULT_CANVAS_PORT,
      derivedPort(root),
    ]);
  });

  test("with no memory, the default comes first and the derived port backs it up", () => {
    expect(portCandidates({ root })).toEqual([DEFAULT_CANVAS_PORT, derivedPort(root)]);
  });

  test("a folder remembered on the default port doesn't ask for it twice", () => {
    expect(portCandidates({ remembered: DEFAULT_CANVAS_PORT, root })).toEqual([
      DEFAULT_CANVAS_PORT,
      derivedPort(root),
    ]);
  });

  test("--port stands alone: an explicit port is an instruction, not a preference", () => {
    expect(portCandidates({ explicit: 7399, remembered: 7318, root })).toEqual([7399]);
  });

  test("the derived port is stable per folder and off 7300/7301", () => {
    for (const path of [root, join(tmp, "other"), "/a", "/b/c", tmpdir()]) {
      const port = derivedPort(path);
      expect(derivedPort(path)).toBe(port);
      expect(port).toBeGreaterThan(DEFAULT_CANVAS_PORT + 1);
      expect(port).toBeLessThan(7400);
    }
  });

  /**
   * Two folders landing on the same port is not a bug — the band holds 90 of
   * them, so any given pair collides about 1% of the time, and the daemon just
   * moves to the next candidate. What has to hold is that the derivation
   * actually spreads folders out. Fixed paths, so the count can't drift with a
   * temp directory's name.
   */
  test("folders spread across the band rather than piling onto one port", () => {
    const ports = new Set(Array.from({ length: 50 }, (_, i) => derivedPort(`/velloo/folder-${i}`)));
    expect(ports.size).toBeGreaterThan(25);
  });
});

describe("design-folder format gate", () => {
  const writeConfig = (config: unknown) =>
    writeFile(join(root, ".design", "config.json"), JSON.stringify(config));

  test("an outdated folder is refused with the upgrade hint", async () => {
    await writeConfig({ schemaVersion: 1 });
    expect(() => assertFolderFormatCurrent(root)).toThrow(/Run `velloo upgrade /);
    try {
      assertFolderFormatCurrent(root);
      throw new Error("expected the gate to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(DesignFolderFormatError);
      expect((err as DesignFolderFormatError).found).toBe(1);
      expect((err as DesignFolderFormatError).current).toBe(CURRENT_SCHEMA_VERSION);
    }
  });

  test("a folder from a newer velloo is refused with the update-velloo hint", async () => {
    await writeConfig({ schemaVersion: CURRENT_SCHEMA_VERSION + 1 });
    expect(() => assertFolderFormatCurrent(root)).toThrow(/Upgrade velloo/);
  });

  test("a current folder and a missing config both pass (the daemon owns the rest)", async () => {
    expect(() => assertFolderFormatCurrent(root)).not.toThrow(); // no config.json yet
    await writeConfig({ schemaVersion: CURRENT_SCHEMA_VERSION });
    expect(() => assertFolderFormatCurrent(root)).not.toThrow();
  });

  test("ensureDaemon refuses an outdated folder before spawning anything", async () => {
    await writeConfig({ schemaVersion: 1 });
    const start = Date.now();
    await expect(ensureDaemon(root)).rejects.toThrow(/Run `velloo upgrade /);
    // The pre-spawn gate, not the 15s health timeout.
    expect(Date.now() - start).toBeLessThan(2000);
    expect(await readLock(root)).toBeNull();
  });
});
