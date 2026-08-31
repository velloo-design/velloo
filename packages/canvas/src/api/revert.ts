import { getJson } from "./discovery.ts";
import { postJson } from "./http.ts";

export type RevertFileStatus = "modified" | "added" | "deleted" | "untracked";

export interface RevertFile {
  /** Path relative to the design folder. */
  path: string;
  status: RevertFileStatus;
}

export interface RevertStatus {
  available: boolean;
  reason?: string;
  files: RevertFile[];
}

export function fetchRevertStatus(): Promise<RevertStatus> {
  return getJson<RevertStatus>("/api/revert/status", "fetchRevertStatus");
}

export function revertAll(): Promise<{ reverted: number; files: RevertFile[] }> {
  return postJson("/api/revert", {});
}
