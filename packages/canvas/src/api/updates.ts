import { getJson } from "./discovery.ts";
import { postJson } from "./http.ts";

export interface UpdateStatus {
  /** Build stamp of the running velloo. */
  current: string;
  /** Build stamp of the newest release on this channel; null when unknown. */
  latest: string | null;
  available: boolean;
  method: string;
  channel: string;
  upgradable: boolean;
  reason?: string;
}

export interface UpdateResult {
  upgraded: boolean;
  from: string;
  to: string;
  restartRequired: boolean;
}

export function fetchUpdateStatus(opts: { refresh?: boolean } = {}): Promise<UpdateStatus> {
  return getJson<UpdateStatus>(
    opts.refresh ? "/api/updates/status?refresh=1" : "/api/updates/status",
    "fetchUpdateStatus",
  );
}

export function runUpgrade(): Promise<UpdateResult> {
  return postJson("/api/updates", {});
}
