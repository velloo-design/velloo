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
