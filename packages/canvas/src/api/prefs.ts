import { getJson } from "./discovery.ts";
import { postJson } from "./http.ts";

/**
 * The person's canvas preferences that outlive a run. The daemon keeps them in
 * `~/.velloo/prefs.json`: each daemon serves the canvas from its own port, and
 * the browser's storage is per origin, so localStorage alone forgets them.
 */
export interface UserPrefs {
  tourSeen: boolean;
}

export function fetchUserPrefs(): Promise<UserPrefs> {
  return getJson<UserPrefs>("/api/prefs", "fetchUserPrefs");
}

export function saveUserPrefs(patch: Partial<UserPrefs>): Promise<UserPrefs> {
  return postJson<UserPrefs>("/api/prefs", patch);
}
