import type { BoardLimit, CloudTeam } from "@velloo/protocol";
import { getJson } from "./discovery.ts";
import { postJson, requestJson } from "./http.ts";

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
  tier?: string | undefined;
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
  | {
      state: "error";
      message: string;
      /** Set when the credential is what failed — the dialog offers a sign-in. */
      signInRequired?: "signed-out" | "expired";
      /**
       * Set when the plan's published-board slots are all taken. The dialog
       * offers the published list, because taking one down is the fix.
       */
      boardLimit?: BoardLimit;
      warnings: string[];
      finishedAt: string;
    };

/** Whether this account can publish, and why not when it can't. */
type PublishAccess = "ready" | "signed-out" | "expired";

export interface PublishTargets {
  /** Convenience mirror of `access === "ready"`. */
  ready: boolean;
  /**
   * Absent on daemons older than this field, where `ready: false` meant only
   * "no credential stored" — a rejected one looked signed in and failed later.
   */
  access?: PublishAccess;
  /**
   * The teams of this account's one organization. Empty for a personal account,
   * and a single entry needs no choosing — only two or more is a real decision.
   */
  teams: CloudTeam[];
  /**
   * Why this account can't publish (a reviewer, say), and what to do about it.
   * The dialog shows it instead of a form that would only be refused after the
   * capture and upload.
   */
  blocked?: string;
  effectiveTeamId?: string | null;
  provenance?: { repo: string | null; branch: string | null };
  slots: PublishSlot[];
  destinationError?: string;
}

/** An existing link this folder could publish into, and what it last carried. */
export interface PublishSlot {
  slug: string;
  url: string;
  title: string;
  teamId: string | null;
  latestVersionId: string | null;
  lastPublishedAt: string | null;
  context: {
    boardIds: string[];
    contextKnown: boolean;
    repo: string | null;
    branch: string | null;
  };
}

/** One link this account has already published, as the manage list shows it. */
export interface PublishedBoard {
  slug: string;
  title: string;
  url: string;
  visibility: "public" | "private";
  passwordProtected: boolean;
  /** False for a teammate's link: visible here, but not this account's to remove. */
  canManage: boolean;
  lastPublishedAt: string | null;
}

export interface PublishRequest {
  /** Board ids to publish; empty = every board in the folder. */
  boardIds: string[];
  title?: string | undefined;
  visibility: "public" | "private";
  /** Anyone with the password can view, whatever the visibility. */
  password?: string | undefined;
  destination: { mode: "new" } | { mode: "update"; slug: string; expectedVersionId: string | null };
  teamId?: string | undefined;
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
  /** Every link this account has published, newest first. */
  async published(): Promise<PublishedBoard[]> {
    const body = await getJson<{ boards: PublishedBoard[] }>(
      "/api/publish/published",
      "publishedBoards",
    );
    return body.boards;
  },
  /** Take a published link down, freeing the plan slot it holds. */
  async unpublish(slug: string): Promise<void> {
    await requestJson<{ ok: boolean }>(
      "DELETE",
      `/api/publish/published/${encodeURIComponent(slug)}`,
    );
  },
};
