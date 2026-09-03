import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CommentStoreError, type LocalCommentsService } from "../../local-comments.ts";
import { jsonResult } from "./result.ts";

async function result<T>(operation: () => Promise<T>) {
  try {
    return jsonResult(await operation());
  } catch (error) {
    if (error instanceof CommentStoreError) {
      return jsonResult({ ok: false, code: error.code, message: error.message });
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
        "List visual feedback threads. By default this returns every open thread across the folder; pass boardId to narrow it. requestedOnly is the explicit agent inbox. Anchors report attached paths or stale when their original node no longer exists.",
      inputSchema: {
        boardId: z.string().optional(),
        status: z.enum(["open", "resolved", "all"]).optional(),
        requestedOnly: z.boolean().optional(),
      },
    },
    async ({ boardId, status = "open", requestedOnly = false }) =>
      result(async () => ({
        threads: boardId
          ? (await comments.list(boardId, status)).filter(
              (thread) =>
                !requestedOnly ||
                thread.scope === "shared" ||
                thread.agentRequestedAt !== undefined,
            )
          : await comments.listAll(status, requestedOnly),
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
    "reply_to_comment",
    {
      description:
        "Reply to a visual feedback thread as the agent. Use resolve_comment separately once the requested change is complete.",
      inputSchema: {
        threadId: z.string().uuid(),
        body: z.string().trim().min(1).max(4000),
      },
    },
    async ({ threadId, body }) =>
      result(async () => ({
        thread: await comments.reply(threadId, {
          body,
          author: { kind: "agent", displayName: "Agent" },
        }),
      })),
  );

  mcp.registerTool(
    "resolve_comment",
    {
      description: "Mark an addressed feedback thread resolved and remove it from the open inbox.",
      inputSchema: { threadId: z.string().uuid() },
    },
    async ({ threadId }) =>
      result(async () => ({ thread: await comments.setResolved(threadId, true) })),
  );

  mcp.registerTool(
    "reopen_comment",
    {
      description: "Reopen a resolved feedback thread.",
      inputSchema: { threadId: z.string().uuid() },
    },
    async ({ threadId }) =>
      result(async () => ({ thread: await comments.setResolved(threadId, false) })),
  );

  mcp.registerTool(
    "delete_comment_thread",
    {
      description:
        "Permanently delete a local feedback thread when the user explicitly asks to remove it. Prefer resolving addressed work so the conversation remains available.",
      inputSchema: { threadId: z.string().uuid() },
    },
    async ({ threadId }) => result(() => comments.delete(threadId)),
  );
}
