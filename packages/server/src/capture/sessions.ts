import {
  type CaptureManifest,
  type CaptureSessionHandle,
  sessionStatePath,
  startCaptureSession,
} from "@velloo/renderer";
import type { MutationContext } from "../mutations/index.ts";

export interface LiveSession {
  handle: CaptureSessionHandle;
  url: string | undefined;
  startedAt: number;
  endedAt: number | null;
}

/**
 * The daemon's live capture sessions.
 *
 * A session is a browser window a human is driving, so it outlives any single
 * request by minutes. Nothing here is awaited by a caller: the MCP tool starts
 * a session and returns its id straight away, and the agent polls for captures
 * as they land. A tool call that blocked for the length of the session would
 * sit on the MCP connection long enough to trip the proxy — which is exactly
 * the failure mode this shape avoids.
 */
const sessions = new Map<string, LiveSession>();

function activeSessions(): LiveSession[] {
  return [...sessions.values()].filter((s) => s.endedAt === null);
}

/** A session as an agent polling for captures needs to see it. */
export interface SessionStatus {
  sessionId: string;
  status: "open" | "closed";
  /** Where the session was opened, when a URL was given. */
  startedUrl: string | null;
  /** The page the user is on right now. Null once the window is gone. */
  currentUrl: string | null;
  openedAt: string;
  endedAt: string | null;
  /** Captures taken during this session, oldest first. */
  captured: { captureId: string; url: string }[];
}

/**
 * What the daemon knows about the browser windows it opened.
 *
 * `start_capture_session` returns immediately by design, which left the agent
 * that called it blind: it could see finished captures appear but not whether
 * the user was still in the browser, still logging in, or had closed the
 * window ten minutes ago. The daemon has tracked all of it since the session
 * map existed — this is the reporting half.
 */
export function sessionStatuses(list: Iterable<LiveSession> = sessions.values()): SessionStatus[] {
  return [...list].map((session) => {
    const open = session.endedAt === null;
    // A handle whose window has gone throws rather than answering.
    const read = <T>(get: () => T): T | null => {
      try {
        return get();
      } catch {
        return null;
      }
    };
    return {
      sessionId: session.handle.sessionId,
      status: open ? "open" : "closed",
      startedUrl: session.url ?? null,
      currentUrl: open ? read(() => session.handle.currentUrl()) : null,
      openedAt: new Date(session.startedAt).toISOString(),
      endedAt: session.endedAt === null ? null : new Date(session.endedAt).toISOString(),
      captured: (read(() => session.handle.captures()) ?? []).map((m) => ({
        captureId: m.id,
        url: m.finalUrl || m.url,
      })),
    };
  });
}

/**
 * Open a capture session for this folder. Rejects a second concurrent session
 * — two browser windows writing one session file would race, and the user only
 * has one pair of hands anyway.
 */
export async function openSession(
  ctx: MutationContext,
  opts: { url?: string; onCapture?: (m: CaptureManifest) => void; onStatus?: (s: string) => void },
): Promise<LiveSession> {
  const existing = activeSessions()[0];
  if (existing) {
    throw new Error(
      `a capture session is already open (${existing.handle.sessionId})${existing.url ? ` on ${existing.url}` : ""} — finish it in the browser window before starting another`,
    );
  }
  const folderId = ctx.folder.config.folderId;
  // Session state partitions by target origin; with no start URL there's no
  // origin to key on yet, so this session simply doesn't persist a credential.
  const statePath = opts.url
    ? sessionStatePath(ctx.folder.root, new URL(opts.url).origin, folderId)
    : undefined;

  const handle = await startCaptureSession({
    folderRoot: ctx.folder.root,
    ...(folderId ? { folderId } : {}),
    ...(opts.url ? { url: opts.url } : {}),
    ...(statePath ? { sessionStatePath: statePath } : {}),
    ...(opts.onCapture ? { onCapture: opts.onCapture } : {}),
    ...(opts.onStatus ? { onStatus: opts.onStatus } : {}),
  });

  const session: LiveSession = {
    handle,
    url: opts.url,
    startedAt: Date.now(),
    endedAt: null,
  };
  sessions.set(handle.sessionId, session);
  void handle.finished.then(() => {
    session.endedAt = Date.now();
  });
  return session;
}
