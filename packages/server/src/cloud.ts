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
  token?: string;
}

/** Who the canvas is signed in as, as velloo-cloud describes them (`GET /v1/me`). */
export interface CanvasAccount {
  email: string;
  /** Display name, when the cloud knows one. */
  name?: string;
  /** Plan tier — "free" | "team" | "business" | "enterprise". */
  tier?: string;
}

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

export interface CanvasPublishRequest {
  /** Board ids to publish; empty = every board in the folder. */
  boardIds: string[];
  title?: string;
  visibility: "public" | "private";
  /** Publish into a team rather than the personal workspace. */
  teamId?: string;
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
  /** Share URL, already carrying the `?k=` key when the link is private. */
  shareUrl: string;
  files: number;
  bytes: number;
  screenshots: number;
  boards: number;
  screens: number;
  /** True when this created the link rather than updating the folder's. */
  created: boolean;
  tier?: string;
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
  teams(): Promise<{ id: string; name: string; isDefault?: boolean }[]>;
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
