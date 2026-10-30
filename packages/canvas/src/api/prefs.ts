import { getJson } from "./discovery.ts";
import { postJson } from "./http.ts";

/**
 * The person's canvas preferences that outlive a run. The daemon keeps them in
 * `~/.velloo/prefs.json`: each daemon serves the canvas from its own port, and
 * the browser's storage is per origin, so localStorage alone forgets them.
 */
export interface UserPrefs {
  /** The canvas hints dismissed, by id. */
  hintsSeen: string[];
}

export function fetchUserPrefs(): Promise<UserPrefs> {
  return getJson<UserPrefs>("/api/prefs", "fetchUserPrefs");
}

/** Dismissing adds to what's dismissed; a reset brings every hint back. */
export function saveUserPrefs(patch: {
  dismissHints?: string[];
  resetHints?: true;
}): Promise<UserPrefs> {
  return postJson<UserPrefs>("/api/prefs", patch);
}
