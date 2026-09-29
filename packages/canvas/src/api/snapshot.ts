import { postJson } from "./http.ts";

/** What `/api/snapshot` did: fragments captured from the app into the design. */
interface SnapshotResult {
  screenId: string;
  snapshots: number;
  warnings: string[];
}

/**
 * Capture a screen's live fragments (or its earlier snapshots) from the running
 * app into the design's own nodes. Refused, with the reason, when the app
 * redirects or fails.
 */
export function snapshotFromApp(screenId: string): Promise<SnapshotResult> {
  return postJson<SnapshotResult>(`/api/snapshot/${encodeURIComponent(screenId)}`, {});
}
