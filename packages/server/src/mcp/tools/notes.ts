import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Result } from "@velloo/result";
import { z } from "zod";
import {
  addAnnotation,
  addNote,
  type MutationContext,
  type MutationError,
  removeAnnotation,
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

  mcp.registerTool(
    "add_annotation",
    {
      description:
        'Pin a markdown annotation to a specific node (questions for the designer, review remarks). The canvas draws a connector to the node in every frame showing it. Created with author: "agent" — you may remove your own annotations later, but user-authored ones are read-only to you.',
      inputSchema: {
        screenId: z.string(),
        path: z
          .union([z.array(z.number().int().nonnegative()), z.string()])
          .describe('Target node — path array or "@id"'),
        body: z.string(),
        collapsed: z.boolean().optional(),
      },
    },
    async ({ screenId, path, body, collapsed }) =>
      toMcp(
        await addAnnotation(ctx, {
          screenId,
          target: { locator: path },
          body,
          collapsed,
          author: "agent",
        }),
      ),
  );

  mcp.registerTool(
    "remove_annotation",
    {
      description:
        "Remove an agent-authored annotation. Refuses user-authored ones — those are the designer's channel to you; act on them, don't delete them.",
      inputSchema: {
        screenId: z.string(),
        annotationId: z.string(),
      },
    },
    async ({ screenId, annotationId }) => {
      const existing = ctx.folder.annotations.get(screenId)?.find((a) => a.id === annotationId);
      if (existing && existing.author !== "agent") {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: JSON.stringify({
                kind: "BadRequest",
                message: `Annotation ${annotationId} is user-authored — agents may only remove their own.`,
              }),
            },
          ],
        };
      }
      return toMcp(await removeAnnotation(ctx, { screenId, annotationId }));
    },
  );
}
