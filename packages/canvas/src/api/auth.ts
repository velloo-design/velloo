import { postJson } from "./http.ts";

export interface CloudAccount {
  email: string;
  name?: string;
  /** Plan tier — "free" | "team" | "business" | "enterprise". */
  tier?: string;
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
  account?: CloudAccount;
  /** false = the cloud rejected the stored token; null = it couldn't be asked. */
  verified: boolean | null;
  login: LoginState;
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
