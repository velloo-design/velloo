import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  realpathSync,
  statSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
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

function spawnDetached(root: string, preferredPort: number | undefined, host: string): void {
  mkdirSync(cacheDir(root), { recursive: true });
  const log = openSync(logPath(root), "a");
  const proc = Bun.spawn(daemonSpawnCmd(root, preferredPort, host), {
    stdin: "ignore",
    stdout: log,
    stderr: log,
  });
  // Let this process exit without waiting for — or killing — the daemon.
  proc.unref();
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

async function waitForHealthy(root: string): Promise<DaemonRecord> {
  const deadline = Date.now() + HEALTHY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const rec = await readLock(root);
    if (rec && (await isLive(rec))) return rec;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`velloo: canvas daemon for ${root} didn't come up — see ${logPath(root)}`);
}

export interface EnsureOptions {
  /** Preferred canvas port when *spawning* a fresh daemon (ignored if one exists). */
  preferredPort?: number;
  host?: string;
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
        spawnDetached(root, opts.preferredPort, host);
        return await waitForHealthy(root);
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
