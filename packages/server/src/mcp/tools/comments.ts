import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CommentStoreError, type LocalCommentsService } from "../../local-comments.ts";
import { errorResult, jsonResult } from "./result.ts";

async function result<T>(operation: () => Promise<T>) {
  try {
    return jsonResult(await operation());
  } catch (error) {
    if (error instanceof CommentStoreError) {
      return errorResult({ kind: "CommentStore", code: error.code, message: error.message });
    }
    throw error;
  }
}

/** Threaded user feedback. Comments are persistent app state, never repo files. */
export function registerCommentTools(mcp: McpServer, comments: LocalCommentsService): void {
  mcp.registerTool(
    "list_comment_threads",
    {
      description:
        "List visual feedback threads. Every open thread is work waiting on you — there is no separate inbox. Returns all open threads across the folder by default; `boardId` narrows, `scope` separates local threads from cloud ones left on a published link. Anchors report their attached path, or stale when the original node is gone.",
      inputSchema: {
        boardId: z.string().optional(),
        status: z.enum(["open", "resolved", "all"]).optional(),
        scope: z.enum(["local", "shared", "all"]).optional(),
      },
    },
    async ({ boardId, status = "open", scope = "all" }) =>
      result(async () => ({
        threads: boardId
          ? await comments.list(boardId, status, scope)
          : await comments.listAll(status, scope),
      })),
  );

  mcp.registerTool(
    "get_comment_thread",
    {
      description: "Read one complete visual feedback thread, including its anchor and replies.",
      inputSchema: { threadId: z.string().uuid() },
    },
    async ({ threadId }) => result(async () => ({ thread: await comments.get(threadId) })),
  );

  mcp.registerTool(
    "update_comment_thread",
    {
      description:
        'Act on a feedback thread: `reply` posts an agent message, `status` moves it to resolved / open / deleted. Both in one call is the normal close-out — reply saying what changed, then resolve. `status: "deleted"` is permanent; only on the user\'s explicit ask. Guide: velloo://guide/comments.',
      inputSchema: {
        threadId: z.string().uuid(),
        reply: z.string().trim().min(1).max(4000).optional().describe("Agent message to post"),
        status: z.enum(["resolved", "open", "deleted"]).optional(),
      },
    },
    async ({ threadId, reply, status }) => {
      if (reply === undefined && status === undefined) {
        return errorResult({
          kind: "BadRequest",
          message: "update_comment_thread: pass reply, status, or both.",
        });
      }
      return result(async () => {
        // Reply first so the closing message lands on the thread before it is
        // resolved or removed.
        let thread = reply
          ? await comments.reply(threadId, {
              body: reply,
              author: { kind: "agent", displayName: "Agent" },
            })
          : undefined;
        if (status === "deleted") return comments.delete(threadId);
        if (status !== undefined)
          thread = await comments.setResolved(threadId, status === "resolved");
        return { thread: thread ?? (await comments.get(threadId)) };
      });
    },
  );
}
