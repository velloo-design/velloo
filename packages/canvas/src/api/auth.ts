import { postJson } from "./http.ts";

export interface CloudAccount {
  email: string;
  name?: string;
  /** Plan tier — "free" | "team" | "business" | "enterprise". */
  tier?: string;
  /** PAYG credit balance in micros; null when the cloud couldn't price it. */
  creditMicros?: number | null;
}

/** A sign-in in flight: `pending` has a code to show, `error` has why it ended. */
export type LoginState =
  | { state: "idle" }
  | { state: "pending"; userCode: string; verificationUrl: string; expiresAt: string }
  | { state: "error"; message: string };

export interface AuthStatus {
  loggedIn: boolean;
  /** The velloo-cloud this folder signs into. */
  cloudUrl?: string;
  /** User-facing home advertised by that cloud; falls back to the API origin. */
  appUrl?: string;
  account?: CloudAccount;
  /** false = the cloud rejected the stored token; null = it couldn't be asked. */
  verified: boolean | null;
  login: LoginState;
}

/**
 * Whether a device-login attempt has actually completed successfully.
 *
 * `loggedIn` alone is not enough: while re-authenticating an expired token,
 * the daemon keeps the old local identity available and reports the new
 * device flow as `pending`. Treating that stale identity as success closes the
 * dialog before the user has approved the new device code.
 */
export function loginAttemptSucceeded(status: AuthStatus): boolean {
  return status.loggedIn && status.login.state === "idle";
}

/**
 * A credential the cloud has *started* rejecting.
 *
 * Only the transition counts. Status is re-read on a timer, and the point of
 * noticing is to say it once — a canvas that re-announced a rejected token
 * every minute would be nagging about a state the user may have chosen to
 * leave alone. `verified: null` is not a rejection: the cloud could not be
 * asked, and the local credential stands.
 */
export function credentialJustRejected(before: AuthStatus | null, after: AuthStatus): boolean {
  return after.loggedIn && after.verified === false && before?.verified !== false;
}

const LOGGED_OUT: AuthStatus = { loggedIn: false, verified: null, login: { state: "idle" } };

export const auth = {
  /** Current velloo-cloud account state (served live from the CLI's ~/.velloo). */
  async status(): Promise<AuthStatus> {
    const res = await fetch("/api/auth/status");
    if (!res.ok) return LOGGED_OUT;
    return (await res.json()) as AuthStatus;
  },
  /**
   * Start the device flow. Resolves once there's a code to show — the sign-in
   * completes in the browser, so poll `status()` until `login` leaves `pending`.
   */
  async login(): Promise<AuthStatus> {
    return postJson<AuthStatus>("/api/auth/login", {});
  },
  /** Abandon a pending sign-in. */
  async cancelLogin(): Promise<void> {
    await postJson<{ ok: boolean }>("/api/auth/login/cancel", {});
  },
  /** Log out — drops the saved CLI token for this cloud. */
  async logout(): Promise<void> {
    await postJson<{ ok: boolean }>("/api/auth/logout", {});
  },
};
