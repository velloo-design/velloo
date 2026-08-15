import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Result } from "@velloo/result";
import { z } from "zod";
import {
  addNote,
  type MutationContext,
  type MutationError,
  removeNote,
  updateNote,
} from "../../mutations/index.ts";

type McpResult = {
  content: { type: "text"; text: string }[];
  isError?: true;
};

function toMcp<T>(result: Result<T, MutationError>): McpResult {
  return result.ok
    ? { content: [{ type: "text", text: JSON.stringify(result.value, null, 2) }] }
    : { isError: true, content: [{ type: "text", text: JSON.stringify(result.error) }] };
}

/**
 * Canvas sticky notes — board-level free-floating commentary in board
 * coordinates. The agent uses them for guidance that belongs *next to*
 * frames rather than inside a screen: tour steps, review remarks,
 * handoff context. (Node-anchored annotations stay designer-authored;
 * the agent reads those via list_annotations.)
 */
export function registerNoteTools(mcp: McpServer, ctx: MutationContext): void {
  mcp.registerTool(
    "add_note",
    {
      description:
        "Add a sticky note to a board at board coordinates (same space as frame x/y — place notes above or beside frames, not on top of them). body is markdown-lite: bold, italics, line breaks, emoji.",
      inputSchema: {
        boardId: z.string(),
        x: z.number(),
        y: z.number(),
        width: z.number().positive().optional().describe("Pixel width; default 240"),
        body: z.string(),
      },
    },
    async (args) => toMcp(await addNote(ctx, args)),
  );

  mcp.registerTool(
    "update_note",
    {
      description: "Patch a board note's position, width, or body.",
      inputSchema: {
        boardId: z.string(),
        noteId: z.string(),
        patch: z.object({
          x: z.number().optional(),
          y: z.number().optional(),
          width: z.number().positive().optional(),
          body: z.string().optional(),
        }),
      },
    },
    async (args) => toMcp(await updateNote(ctx, args)),
  );

  mcp.registerTool(
    "remove_note",
    {
      description: "Remove a board note by id.",
      inputSchema: {
        boardId: z.string(),
        noteId: z.string(),
      },
    },
    async (args) => toMcp(await removeNote(ctx, args)),
  );
}
