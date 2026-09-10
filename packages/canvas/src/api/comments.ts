import type { CommentAnchor, CommentThreadView } from "@velloo/schema";
import { getJson } from "./discovery.ts";
import { requestJson } from "./http.ts";

export type CommentStatusFilter = "open" | "resolved" | "all";
export type CommentScope = "local" | "shared";
export type CommentScopeFilter = CommentScope | "all";

/** Whether this board can take a cloud thread, and why not when it can't. */
export type CloudCommentAvailability =
  | { available: true; slug: string; url: string }
  | { available: false; reason: CloudCommentBlocker };

export type CloudCommentBlocker = "signed-out" | "expired" | "unpublished" | "unsupported";

/** The blockers a sign-in clears — the picker offers one for these. */
export const signInClears = (reason: CloudCommentBlocker): boolean =>
  reason === "signed-out" || reason === "expired";

/**
 * Why the cloud target is closed, in the words the UI shows. Lives beside the
 * blocker itself rather than in a component: the store says the same thing
 * when a cloud comment gives up mid-flight, and one wording is the point.
 */
export function cloudUnavailableHint(reason: CloudCommentBlocker): string {
  switch (reason) {
    case "signed-out":
      return "Sign in to velloo cloud to write a cloud comment.";
    case "expired":
      return "Your velloo-cloud session has ended — sign in again to write a cloud comment.";
    case "unpublished":
      return "Publish this board to write a cloud comment on it.";
    default:
      return "This canvas cannot write cloud comments.";
  }
}

export const comments = {
  async list(
    boardId: string,
    status: CommentStatusFilter,
    scope: CommentScopeFilter = "all",
  ): Promise<CommentThreadView[]> {
    const query = new URLSearchParams({ boardId, status, scope });
    const response = await getJson<{ threads: CommentThreadView[] }>(
      `/api/comments?${query}`,
      "fetchComments",
    );
    return response.threads;
  },
  cloudAvailability(boardId: string): Promise<CloudCommentAvailability> {
    const query = new URLSearchParams({ boardId });
    return getJson<CloudCommentAvailability>(`/api/comments/cloud?${query}`, "fetchCloudComments");
  },
  async create(args: {
    boardId: string;
    body: string;
    anchor?: CommentAnchor;
    scope?: CommentScope;
  }): Promise<CommentThreadView> {
    return (await requestJson<{ thread: CommentThreadView }>("POST", "/api/comments", args)).thread;
  },
  async reply(threadId: string, body: string): Promise<CommentThreadView> {
    return (
      await requestJson<{ thread: CommentThreadView }>(
        "POST",
        `/api/comments/${encodeURIComponent(threadId)}/messages`,
        { body },
      )
    ).thread;
  },
  async update(
    threadId: string,
    patch: { resolved?: boolean; scope?: "shared" },
  ): Promise<CommentThreadView> {
    return (
      await requestJson<{ thread: CommentThreadView }>(
        "PATCH",
        `/api/comments/${encodeURIComponent(threadId)}`,
        patch,
      )
    ).thread;
  },
  delete(threadId: string): Promise<{ removedId: string; boardId: string }> {
    return requestJson("DELETE", `/api/comments/${encodeURIComponent(threadId)}`);
  },
  async deleteMessage(threadId: string, messageId: string): Promise<CommentThreadView> {
    const path = `/api/comments/${encodeURIComponent(threadId)}/messages/${encodeURIComponent(messageId)}`;
    return (await requestJson<{ thread: CommentThreadView }>("DELETE", path)).thread;
  },
};
