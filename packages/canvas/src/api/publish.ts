import { getJson } from "./discovery.ts";
import { postJson } from "./http.ts";

export interface PublishResult {
  /** The share URL — stable across publishes, and never carrying a secret. */
  shareUrl: string;
  /** What the link asks of a visitor, so the dialog can say it back. */
  visibility: "public" | "private";
  passwordProtected: boolean;
  files: number;
  bytes: number;
  screenshots: number;
  boards: number;
  screens: number;
  /** True when this created the link rather than updating the folder's. */
  created: boolean;
  tier?: string;
  history?: { retained: boolean; versions: number; pruned: number };
}

/**
 * Where a publish got to. It runs in the daemon rather than inside a request —
 * a capture pass plus an upload is far too long to hold one open — so the
 * dialog polls this while `running`.
 */
export type PublishState =
  | { state: "idle" }
  /** No CLI behind this server, so publishing isn't possible at all. */
  | { state: "unavailable" }
  | {
      state: "running";
      step: string;
      message: string;
      capture?: { done: number; total: number };
      startedAt: string;
      warnings: string[];
    }
  | { state: "done"; result: PublishResult; warnings: string[]; finishedAt: string }
  | { state: "error"; message: string; warnings: string[]; finishedAt: string };

export interface PublishTargets {
  /** False when nothing is signed in — the dialog asks for sign-in instead. */
  ready: boolean;
  /**
   * The teams of this account's one organization. Empty for a personal account,
   * and a single entry needs no choosing — only two or more is a real decision.
   */
  teams: { id: string; name: string; isDefault?: boolean }[];
}

export interface PublishRequest {
  /** Board ids to publish; empty = every board in the folder. */
  boardIds: string[];
  title?: string;
  visibility: "public" | "private";
  /** Anyone with the password can view, whatever the visibility. */
  password?: string;
  teamId?: string;
  screenshots: boolean;
}

export const publish = {
  /** Sign-in state + the teams this account can publish into. */
  targets(): Promise<PublishTargets> {
    return getJson("/api/publish/targets", "publishTargets");
  },
  status(): Promise<PublishState> {
    return getJson("/api/publish/status", "publishStatus");
  },
  /** Begin a publish. Rejects with the daemon's message when one is already running. */
  start(request: PublishRequest): Promise<PublishState> {
    return postJson<PublishState>("/api/publish", request);
  },
  /** Drop a settled run so the dialog reopens clean. */
  async reset(): Promise<void> {
    await postJson<{ ok: boolean }>("/api/publish/reset", {});
  },
};
