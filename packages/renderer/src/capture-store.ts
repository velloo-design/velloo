import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { type StorageState, scopeStorageState, sessionExpired } from "./capture-session-state.ts";

/**
 * Everything a capture session writes lives here — under the user's home
 * directory, never inside the design folder.
 *
 * The design folder is committed, published, and exported; a browser session
 * file is a live credential for the user's real app and a capture is a copy of
 * that app's content. A gitignore entry is a seatbelt, but being outside the
 * repo entirely is the actual guarantee: it cannot be committed, cannot be
 * swept into a `velloo publish` bundle, and cannot ride along in an export.
 * (`publish` builds its bundle from the parsed design folder rather than
 * walking the directory, which is a property worth keeping.)
 */
export function vellooHome(): string {
  return process.env.VELLOO_HOME ?? join(homedir(), ".velloo");
}

/**
 * A stable per-folder key. Prefers the folder's cloud identity when it has one
 * (config.json `folderId`, assigned on first publish) and otherwise hashes the
 * real path, so moving a folder starts a clean store rather than silently
 * inheriting another folder's captures.
 */
export function folderKey(root: string, folderId?: string): string {
  if (folderId) return folderId;
  let real = root;
  try {
    real = realpathSync(root);
  } catch {
    real = resolve(root);
  }
  return createHash("sha256").update(real).digest("hex").slice(0, 16);
}

export function capturesDir(root: string, folderId?: string): string {
  return join(vellooHome(), "captures", folderKey(root, folderId));
}

export function sessionsDir(root: string, folderId?: string): string {
  return join(vellooHome(), "sessions", folderKey(root, folderId));
}

/** Session files partition by target origin, so two apps don't share a jar. */
export function sessionStatePath(root: string, origin: string, folderId?: string): string {
  const key = createHash("sha256").update(origin).digest("hex").slice(0, 12);
  return join(sessionsDir(root, folderId), `${key}.json`);
}

/** What a capture directory contains, and how it was produced. */
export interface CaptureManifest {
  id: string;
  url: string;
  finalUrl: string;
  title: string;
  capturedAt: string;
  viewport: { w: number; h: number };
  /** Files actually written — MHTML in particular may be absent. */
  files: string[];
  assetCount: number;
  nodeCount: number;
  /** A theme-only capture carries computed vars but no page render. */
  themeOnly: boolean;
  /**
   * Versioned capture metadata. Absent means a legacy v1 capture, whose
   * geometry can still be inferred from `viewport` + the PNG header.
   */
  captureVersion?: 2;
  kind?: "page" | "theme";
  /** Session that produced this capture, when it came from the headed workflow. */
  sessionId?: string;
  /** Hash of the browser state verified on both sides of the screenshot. */
  stateId?: string;
  geometry?: CaptureGeometry;
  stability?: CaptureStability;
}

export interface CaptureGeometry {
  viewportCss: { width: number; height: number };
  documentCssHeight: number;
  scrollCss: { x: number; y: number };
  devicePixelRatio: number;
  screenshot?: {
    mode: "full-page" | "viewport";
    bitmapWidth: number;
    bitmapHeight: number;
  };
  replay?: {
    format: "mhtml";
    cssHeight: number;
    fidelity: "best-effort";
  };
}

export interface CaptureStability {
  status: "stable" | "unstable" | "not-applicable";
  attempts: number;
  /** Present when the page changed during the final capture attempt. */
  beforeStateId?: string;
  afterStateId?: string;
}

const MANIFEST = "capture.json";

function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
}

export function captureDir(root: string, id: string, folderId?: string): string {
  return join(capturesDir(root, folderId), id);
}

export function writeCaptureManifest(dir: string, manifest: CaptureManifest): void {
  ensureDir(dir);
  writeFileSync(join(dir, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
}

/** Newest first. A directory without a readable manifest is skipped, not fatal. */
export function listCaptures(root: string, folderId?: string): CaptureManifest[] {
  const dir = capturesDir(root, folderId);
  if (!existsSync(dir)) return [];
  const out: CaptureManifest[] = [];
  for (const entry of readdirSync(dir)) {
    try {
      const raw = readFileSync(join(dir, entry, MANIFEST), "utf8");
      out.push(JSON.parse(raw) as CaptureManifest);
    } catch {
      // Half-written or hand-mangled capture — not worth failing a listing over.
    }
  }
  return out.sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
}

export function readCaptureManifest(
  root: string,
  id: string,
  folderId?: string,
): CaptureManifest | null {
  try {
    const raw = readFileSync(join(captureDir(root, id, folderId), MANIFEST), "utf8");
    return JSON.parse(raw) as CaptureManifest;
  } catch {
    return null;
  }
}

/** True if something was removed. Deleting a capture is a user-facing action. */
export function deleteCapture(root: string, id: string, folderId?: string): boolean {
  if (!isSafeCaptureId(id)) return false;
  const dir = captureDir(root, id, folderId);
  if (!existsSync(dir)) return false;
  rmSync(dir, { recursive: true, force: true });
  return true;
}

/**
 * Capture ids are generated, but they also arrive from HTTP paths and MCP
 * arguments — so they're validated before ever reaching a filesystem join.
 */
export function isSafeCaptureId(id: string): boolean {
  return /^[A-Za-z0-9_-]{1,64}$/.test(id);
}

/** Files inside a capture are served over HTTP; the same rule applies to them. */
export function isSafeCaptureFile(file: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(file) && !file.includes("..");
}

export function newCaptureId(): string {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:.TZ]/g, "")
    .slice(0, 14);
  return `${stamp}-${createHash("sha256").update(`${Math.random()}${Date.now()}`).digest("hex").slice(0, 6)}`;
}

/**
 * Persist a browser session, scoped and pruned. Returns the path written.
 *
 * Written 0600 under a 0700 directory: on a shared machine the file's contents
 * are a working login to the user's app.
 */
export function writeSessionState(
  path: string,
  state: StorageState,
  capturedOrigins: readonly string[],
): string {
  const scoped = scopeStorageState(state, capturedOrigins);
  ensureDir(join(path, ".."));
  writeFileSync(path, `${JSON.stringify(scoped, null, 2)}\n`, { mode: 0o600 });
  return path;
}

/**
 * Read a session back, or null when it's absent, unreadable, or aged out.
 * An expired file is deleted on read rather than left to rot — the credential
 * has no further use and no reason to stay on disk.
 */
export function readSessionState(path: string): StorageState | null {
  try {
    if (!existsSync(path)) return null;
    const age = statSync(path).mtimeMs;
    if (sessionExpired(age)) {
      rmSync(path, { force: true });
      return null;
    }
    const parsed = JSON.parse(readFileSync(path, "utf8")) as StorageState;
    if (!Array.isArray(parsed.cookies) || !Array.isArray(parsed.origins)) return null;
    return parsed;
  } catch {
    return null;
  }
}
