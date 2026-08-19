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
