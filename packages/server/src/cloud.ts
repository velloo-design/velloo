import type { CloudAccount, CloudTeam } from "@velloo/protocol";
import type { ComponentProvider } from "@velloo/provider";
import type { DesignFolder } from "./design-folder.ts";

/**
 * Credentials for the optional, opt-in calls velloo makes to velloo-cloud.
 *
 * The server package reads no credentials itself — the CLI (`velloo run`)
 * resolves them from `~/.velloo/credentials.json` and threads them in. Generic
 * on purpose: `send_feedback` uses it today, and `pull_comments` (cloud.md §2)
 * will reuse the same shape — so do NOT name it after feedback.
 */
export interface CloudAuth {
  /** velloo-cloud base URL, already normalized (no trailing slash). */
  url: string;
  /** `vlk_` CLI token, absent when the user is logged out. */
  token?: string | undefined;
  /**
   * Re-read the token from wherever the embedder keeps it. The CLI resolves
   * credentials once at daemon boot, so without this a user who signs in
   * mid-session stays logged out to every cloud call until they restart the
   * server — which is exactly the flow a metered feature provokes (hit the
   * paywall, sign in, retry). `CanvasAuth` already re-reads live; this closes
   * the same gap for the MCP-side callers. Absent ⇒ fall back to `token`.
   */
  resolveToken?: () => Promise<string | undefined>;
}

/**
 * The token to send right now: live when the embedder can re-read it, else the
 * one captured at boot. Every cloud call goes through this rather than reading
 * `cloud.token` directly.
 */
export async function currentToken(cloud: CloudAuth): Promise<string | undefined> {
  if (cloud.resolveToken) {
    try {
      return (await cloud.resolveToken()) ?? cloud.token;
    } catch {
      // A credentials file that's mid-write or unreadable must not break a call
      // that the boot-time token could still serve.
      return cloud.token;
    }
  }
  return cloud.token;
}

/**
 * Who the canvas is signed in as. Exactly what `GET /v1/me` answers, so it is
 * that response's schema rather than a third hand-copy of the same fields.
 */
export type CanvasAccount = CloudAccount;

/**
 * A sign-in the canvas started. The OAuth device flow needs the user to type a
 * code in a browser, so it can't complete inside one request: `pending` carries
 * what to show them, and `error` holds why the last attempt ended (expired
 * code, cloud unreachable) until the next one starts.
 */
export type CanvasLogin =
  | { state: "idle" }
  | { state: "pending"; userCode: string; verificationUrl: string; expiresAt: string }
  | { state: "error"; message: string };

export interface CanvasAuthStatus {
  loggedIn: boolean;
  /** The velloo-cloud this daemon signs into — an account is scoped to one. */
  cloudUrl?: string;
  /**
   * User-facing home advertised by that cloud (`GET /v1/auth/config`), falling
   * back to the API origin when the cloud doesn't name one.
   */
  appUrl?: string;
  account?: CanvasAccount;
  /**
   * The cloud's verdict on the stored token: true = accepted, false = rejected
   * (revoked or expired, so the canvas offers a fresh sign-in), null = not
   * asked yet or the cloud is unreachable, where the local credential stands.
   */
  verified: boolean | null;
  login: CanvasLogin;
}

/**
 * Live login state, sign-in, and sign-out for the canvas's account menu. The
 * server reads no credentials itself — the CLI (which owns `~/.velloo`)
 * implements this and the `/api/auth` routes call it, so the menu reflects
 * signing in or out without a restart. Omitted ⇒ the canvas reports "logged
 * out" and offers no sign-in.
 */
export interface CanvasAuth {
  /** Current login state, read live (e.g. from `~/.velloo`). */
  status(): Promise<CanvasAuthStatus>;
  /**
   * Start the device flow, resolving once there's a code to show — the flow
   * itself continues in the background, so the canvas polls `status()` for the
   * outcome. Calling it while one is pending returns that pending sign-in.
   */
  beginLogin(): Promise<CanvasAuthStatus>;
  /** Abandon a pending sign-in. */
  cancelLogin(): Promise<void>;
  /** Log out — remove the saved credential for this cloud. */
  logout(): Promise<void>;
}

/** What `/api/auth/status` reports with no CLI controller behind it. */
export const LOGGED_OUT: CanvasAuthStatus = {
  loggedIn: false,
  verified: null,
  login: { state: "idle" },
};

/**
 * The render inputs a publish needs. The daemon already holds all of them —
 * the loaded folder, its resolved providers, and a warm Tailwind JIT — so it
 * lends them to the publisher rather than making it reload the folder and
 * recompile styles from scratch.
 */
export interface PublishHost {
  folder: DesignFolder;
  providers: Record<string, ComponentProvider>;
  defaultProvider: ComponentProvider;
  /** Compiled Tailwind for the whole folder — the cloud serves it as-is. */
  snapshotCss(): Promise<string>;
}

export interface CanvasPublishSlot {
  slug: string;
  url: string;
  title: string;
  teamId: string | null;
  latestVersionId: string | null;
  lastPublishedAt: string | null;
  context: {
    boardIds: string[];
    contextKnown: boolean;
    repo: string | null;
    branch: string | null;
  };
}

export interface CanvasPublishDestinations {
  effectiveTeamId: string | null;
  provenance: { repo: string | null; branch: string | null };
  slots: CanvasPublishSlot[];
}

export interface CanvasPublishRequest {
  /** Board ids to publish; empty = every board in the folder. */
  boardIds: string[];
  title?: string | undefined;
  visibility: "public" | "private";
  /**
   * Password-protect the link. Independent of visibility — anyone who has the
   * password can view. Sent straight through to the cloud, never persisted.
   */
  password?: string | undefined;
  destination: { mode: "new" } | { mode: "update"; slug: string; expectedVersionId: string | null };
  /** Publish into a team rather than the personal workspace. */
  teamId?: string | undefined;
  screenshots: boolean;
}

/** A step the publish reached, for the canvas's progress line. */
export interface CanvasPublishProgress {
  step: string;
  message: string;
  /** Screenshot progress, when the capture pass is what's running. */
  capture?: { done: number; total: number };
}

export interface CanvasPublishResult {
  /** The share URL — the same one every time, and never carrying a secret. */
  shareUrl: string;
  /** What the link asks of a visitor, so the dialog can say it back. */
  visibility: "public" | "private";
  passwordProtected: boolean;
  files: number;
  bytes: number;
  screenshots: number;
  boards: number;
  screens: number;
  /** True when this created the link rather than updating the folder's. */
  created: boolean;
  tier?: string | undefined;
  history?: { retained: boolean; versions: number; pruned: number };
}

/**
 * Publishing to velloo-cloud on the canvas's behalf. Like {@link CanvasAuth}
 * this is implemented by the CLI, which owns both the credential store and the
 * cloud transport — the server contributes the render pipeline and the
 * one-at-a-time run state, and never learns a token.
 */
export interface CanvasPublish {
  /**
   * The teams of the account's one organization, so a picker can offer them.
   * Empty for an account with no organization: that publish is personal, and
   * the cloud allows no other target. `isDefault` marks where a publish lands
   * when none is named.
   */
  teams(): Promise<CloudTeam[]>;
  /** Existing link slots plus this folder's best-effort Git provenance. */
  destinations(host: PublishHost): Promise<CanvasPublishDestinations>;
  /** Whether a credential exists at all — the dialog asks for sign-in if not. */
  ready(): Promise<boolean>;
  run(
    host: PublishHost,
    request: CanvasPublishRequest,
    onProgress: (progress: CanvasPublishProgress) => void,
    onWarning: (message: string) => void,
  ): Promise<CanvasPublishResult>;
}

const LOOPBACK_CLOUD_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * A cloud URL is safe to send the `vlk_` bearer to only over HTTPS, or over
 * plain HTTP to a loopback host (local dev). Mirrors the CLI's guard.
 */
export function isSecureCloudUrl(cloudUrl: string): boolean {
  try {
    const u = new URL(cloudUrl);
    if (u.protocol === "https:") return true;
    return u.protocol === "http:" && LOOPBACK_CLOUD_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}
