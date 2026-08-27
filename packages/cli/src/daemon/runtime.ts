import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  statSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { CURRENT_SCHEMA_VERSION, schemaVersionOf } from "@velloo/schema";
import { writeJsonAtomic } from "@velloo/server";
import { TOOL_VERSION } from "../version.ts";

/**
 * One persistent canvas daemon per design folder. `velloo run` and every
 * agent's `velloo mcp` attach to it instead of booting their own canvas, so a
 * folder has a single canvas URL and a single writer (the daemon owns the
 * in-memory state + the HTTP MCP). It outlives any session and auto-exits when
 * idle.
 */
export interface DaemonRecord {
  /** realpath of the design folder — the daemon's identity. */
  root: string;
  pid: number;
  canvasUrl: string;
  canvasPort: number;
  mcpUrl: string;
  mcpPort: number;
  version: string;
  startedAt: string;
}

/** A spawn mutex older than this is presumed abandoned (the spawner crashed). */
const MUTEX_STALE_MS = 15_000;
const HEALTHY_TIMEOUT_MS = 15_000;

// Runtime state lives under .design/cache/, which is already gitignored.
const cacheDir = (root: string) => join(root, ".design", "cache");
const lockPath = (root: string) => join(cacheDir(root), "runtime.json");
const mutexPath = (root: string) => join(cacheDir(root), "runtime.lock");
const logPath = (root: string) => join(cacheDir(root), "daemon.log");

const registryPath = () =>
  process.env.VELLOO_DAEMONS_PATH ?? join(homedir(), ".velloo", "daemons.json");

export function daemonRoot(folder: string): string {
  // Resolve symlinks so two paths to the same folder map to one daemon.
  const abs = resolve(folder);
  return existsSync(abs) ? realpathSync(abs) : abs;
}

/** The folder's on-disk format doesn't match this binary — see {@link assertFolderFormatCurrent}. */
export class DesignFolderFormatError extends Error {
  constructor(
    message: string,
    readonly root: string,
    readonly found: number,
    readonly current: number,
  ) {
    super(message);
    this.name = "DesignFolderFormatError";
  }
}

/**
 * Refuse a folder whose on-disk format this binary can't serve — a spawned
 * daemon would only exit into the same refusal, and the caller would burn the
 * whole health timeout learning it. Mirrors the loadDesignFolder gate (same
 * wording); a missing/unreadable config is NOT gated here — the daemon owns
 * reporting that (it may be a legit not-a-design-folder error).
 */
export function assertFolderFormatCurrent(root: string): void {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(join(root, ".design", "config.json"), "utf8"));
  } catch {
    return;
  }
  const found = schemaVersionOf(raw);
  if (found === CURRENT_SCHEMA_VERSION) return;
  const message =
    found > CURRENT_SCHEMA_VERSION
      ? `velloo: ${root} uses design-folder schema version ${found}, but this velloo ` +
        `only knows version ${CURRENT_SCHEMA_VERSION}. Upgrade velloo to open it.`
      : `velloo: ${root} uses design-folder schema version ${found} ` +
        `(current: ${CURRENT_SCHEMA_VERSION}). Run \`velloo upgrade\` to migrate it.`;
  throw new DesignFolderFormatError(message, root, found, CURRENT_SCHEMA_VERSION);
}

export async function readLock(root: string): Promise<DaemonRecord | null> {
  try {
    return JSON.parse(await readFile(lockPath(root), "utf8")) as DaemonRecord;
  } catch {
    return null;
  }
}

export async function writeLock(rec: DaemonRecord): Promise<void> {
  await writeJsonAtomic(lockPath(rec.root), rec);
}

export function removeLock(root: string): void {
  try {
    unlinkSync(lockPath(root));
  } catch {
    // already gone
  }
}

/**
 * Confirm a record points at a live velloo daemon for *this* folder — not a
 * stale entry and not some foreign process that happens to hold the port.
 */
export async function isLive(rec: DaemonRecord): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${rec.canvasPort}/api/health`, {
      signal: AbortSignal.timeout(1000),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { app?: string; root?: string };
    return body.app === "velloo" && body.root === rec.root;
  } catch {
    return false;
  }
}

// ── Global registry (for `velloo status` / `velloo stop --all`) ──────────────
// Best-effort index of running daemons; the per-folder lockfile stays the
// source of truth for a single folder.

async function registryRead(): Promise<DaemonRecord[]> {
  try {
    const raw = JSON.parse(await readFile(registryPath(), "utf8"));
    return Array.isArray(raw) ? (raw as DaemonRecord[]) : [];
  } catch {
    return [];
  }
}

async function registryWrite(records: DaemonRecord[]): Promise<void> {
  const p = registryPath();
  await mkdir(dirname(p), { recursive: true });
  await writeJsonAtomic(p, records);
}

export async function registryUpsert(rec: DaemonRecord): Promise<void> {
  const others = (await registryRead()).filter((r) => r.root !== rec.root);
  await registryWrite([...others, rec]);
}

export async function registryRemove(root: string): Promise<void> {
  await registryWrite((await registryRead()).filter((r) => r.root !== root));
}

/** Live daemons, pruning registry entries that no longer answer. */
export async function listDaemons(): Promise<DaemonRecord[]> {
  const all = await registryRead();
  const live: DaemonRecord[] = [];
  for (const rec of all) if (await isLive(rec)) live.push(rec);
  if (live.length !== all.length) await registryWrite(live);
  return live;
}

// ── Spawn + ensure ───────────────────────────────────────────────────────────

/**
 * Re-invoke this same CLI's hidden `__daemon` command. From source that's
 * `bun cli.ts __daemon …`; from the compiled binary it's `velloo __daemon …`
 * (the entry script isn't a real file on disk).
 */
function daemonSpawnCmd(root: string, preferredPort: number | undefined, host: string): string[] {
  const args = ["__daemon", root, "--host", host];
  if (preferredPort !== undefined) args.push("--port", String(preferredPort));
  const entry = Bun.main;
  return existsSync(entry) ? [process.execPath, entry, ...args] : [process.execPath, ...args];
}

interface SpawnedDaemon {
  exited: Promise<number>;
  /** Log size before this spawn — the child's own output starts here. */
  logStart: number;
}

function spawnDetached(
  root: string,
  preferredPort: number | undefined,
  host: string,
): SpawnedDaemon {
  mkdirSync(cacheDir(root), { recursive: true });
  let logStart = 0;
  try {
    logStart = statSync(logPath(root)).size;
  } catch {
    // first spawn — no log yet
  }
  const log = openSync(logPath(root), "a");
  const proc = Bun.spawn(daemonSpawnCmd(root, preferredPort, host), {
    stdin: "ignore",
    stdout: log,
    stderr: log,
  });
  // Let this process exit without waiting for — or killing — the daemon.
  proc.unref();
  return { exited: proc.exited, logStart };
}

/** Try to claim the spawn mutex; returns true if we own it and must spawn. */
function claimMutex(root: string): boolean {
  const path = mutexPath(root);
  try {
    const fd = openSync(path, "wx");
    writeSync(fd, String(process.pid));
    closeSync(fd);
    return true;
  } catch {
    // Exists — steal it only if it's abandoned.
    try {
      if (Date.now() - statSync(path).mtimeMs > MUTEX_STALE_MS) {
        unlinkSync(path);
        return claimMutex(root);
      }
    } catch {
      // race: someone removed it — let the caller retry the loop
    }
    return false;
  }
}

function releaseMutex(root: string): void {
  try {
    unlinkSync(mutexPath(root));
  } catch {
    // already gone
  }
}

/**
 * The spawned daemon exited before turning healthy. Quote what it appended to
 * the log (its stdout/stderr was redirected there) so the caller sees the
 * actual refusal instead of a generic pointer at the file.
 */
function startupFailure(root: string, logStart: number): string {
  let appended = "";
  try {
    appended = readFileSync(logPath(root), "utf8").slice(logStart);
  } catch {
    // log unreadable — fall through to the generic pointer
  }
  const lines = appended
    .split("\n")
    .map((l) => l.replace(/^velloo __daemon: /, "").trimEnd())
    .filter((l) => l.trim().length > 0)
    .slice(-8);
  if (lines.length === 0) {
    return `velloo: the canvas daemon for ${root} exited during startup with no output — see ${logPath(root)}`;
  }
  return `velloo: the canvas daemon for ${root} exited during startup:\n  ${lines.join("\n  ")}`;
}

async function waitForHealthy(root: string, spawned?: SpawnedDaemon): Promise<DaemonRecord> {
  const deadline = Date.now() + HEALTHY_TIMEOUT_MS;
  let died = false;
  if (spawned) void spawned.exited.then(() => (died = true));
  while (Date.now() < deadline) {
    const rec = await readLock(root);
    if (rec && (await isLive(rec))) return rec;
    // A healthy daemon never exits, so our child dying first is a startup
    // failure — report its own words now instead of polling out the timeout.
    if (died) throw new Error(startupFailure(root, spawned?.logStart ?? 0));
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`velloo: canvas daemon for ${root} didn't come up — see ${logPath(root)}`);
}

export interface EnsureOptions {
  /** Preferred canvas port when *spawning* a fresh daemon (ignored if one exists). */
  preferredPort?: number;
  host?: string;
  /**
   * Called when this call spawns a *fresh* daemon (vs. attaching to a live one).
   * Lets a caller report whether daemon-time settings — e.g. the trace env var —
   * actually took effect, since they only apply to a daemon this process spawns.
   */
  onSpawn?: () => void;
}

/**
 * Return the live daemon for this folder, spawning a detached one if needed.
 * Safe under concurrent callers (two agents starting at once): a spawn mutex
 * elects one spawner; the rest poll until the daemon is healthy and attach.
 */
export async function ensureDaemon(
  folder: string,
  opts: EnsureOptions = {},
): Promise<DaemonRecord> {
  const root = daemonRoot(folder);
  assertFolderFormatCurrent(root);
  const host = opts.host ?? "127.0.0.1";
  mkdirSync(cacheDir(root), { recursive: true }); // mutex + lockfile live here
  const deadline = Date.now() + HEALTHY_TIMEOUT_MS + 5000;

  while (Date.now() < deadline) {
    const existing = await readLock(root);
    if (existing && (await isLive(existing))) {
      if (existing.version === TOOL_VERSION) return existing;
      // Version skew: a daemon from an older binary. Replace it.
      await stopDaemon(root);
    }

    if (claimMutex(root)) {
      try {
        // Re-check inside the mutex: someone may have just finished spawning.
        const again = await readLock(root);
        if (again && (await isLive(again)) && again.version === TOOL_VERSION) return again;
        const spawned = spawnDetached(root, opts.preferredPort, host);
        opts.onSpawn?.();
        return await waitForHealthy(root, spawned);
      } finally {
        releaseMutex(root);
      }
    }

    // Another process is spawning — wait and re-check.
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`velloo: timed out ensuring a canvas daemon for ${root}`);
}

/** Stop the daemon for a folder (SIGTERM + wait). Returns false if none ran. */
export async function stopDaemon(root: string): Promise<boolean> {
  const rec = await readLock(root);
  if (!rec) return false;
  try {
    process.kill(rec.pid, "SIGTERM");
  } catch {
    // Already dead — fall through to clean up the lockfile.
  }
  // Wait for it to release the lockfile (it removes it on exit), up to ~3s.
  for (let i = 0; i < 30; i++) {
    if (!(await isLive(rec))) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  removeLock(root);
  await registryRemove(root);
  return true;
}
