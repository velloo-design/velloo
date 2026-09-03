import type { CommentAnchor, CommentThreadView } from "@velloo/schema";
import { getJson } from "./discovery.ts";
import { requestJson } from "./http.ts";

export type CommentStatusFilter = "open" | "resolved" | "all";

export const comments = {
  async list(boardId: string, status: CommentStatusFilter): Promise<CommentThreadView[]> {
    const query = new URLSearchParams({ boardId, status });
    const response = await getJson<{ threads: CommentThreadView[] }>(
      `/api/comments?${query}`,
      "fetchComments",
    );
    return response.threads;
  },
  async create(args: {
    boardId: string;
    body: string;
    anchor?: CommentAnchor;
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
    patch: { resolved?: boolean; agentRequested?: boolean },
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
};
