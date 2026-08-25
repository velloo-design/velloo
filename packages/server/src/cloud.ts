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

/**
 * Live login state for the canvas's account menu. The server reads no
 * credentials itself — the CLI (which owns `~/.velloo`) implements this and the
 * `/api/auth` routes call it, so the menu reflects sign-in/out without a
 * restart. Omitted ⇒ the canvas reports "logged out".
 */
export interface CanvasAuth {
  /** Current login state, read live (e.g. from `~/.velloo`). */
  status(): Promise<{ loggedIn: boolean; email?: string }>;
  /** Log out — remove the saved credential for this cloud. */
  logout(): Promise<void>;
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
