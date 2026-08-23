import { postJson } from "./http.ts";

export interface AuthStatus {
  loggedIn: boolean;
  email?: string;
}

export const auth = {
  /** Current velloo-cloud login state (served live from the CLI's ~/.velloo). */
  async status(): Promise<AuthStatus> {
    const res = await fetch("/api/auth/status");
    if (!res.ok) return { loggedIn: false };
    return (await res.json()) as AuthStatus;
  },
  /** Log out — drops the saved CLI token for this cloud. */
  async logout(): Promise<void> {
    await postJson<{ ok: boolean }>("/api/auth/logout", {});
  },
};
