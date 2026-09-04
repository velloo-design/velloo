import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { badRequest } from "../../mutations/errors.ts";
import {
  addAnnotation,
  addNote,
  type MutationContext,
  removeAnnotation,
  removeNote,
  updateAnnotation,
  updateNote,
} from "../../mutations/index.ts";
import { errorResult, toMcp } from "./result.ts";
import { PathSchema } from "./schemas.ts";

/**
 * Canvas sticky notes — board commentary, either free-floating in board
 * coordinates or attached to a node inside a frame. The agent uses them
 * for guidance that belongs beside or on the design rather than inside a
 * screen tree: tour steps, review remarks, handoff context.
 */
export function registerNoteTools(mcp: McpServer, ctx: MutationContext): void {
  mcp.registerTool(
    "add_note",
    {
      description:
        "Add a sticky note to a board. Either free-floating at board coordinates (same space as frame x/y; place beside frames, not on them) or attached to a node — pass `attachment` and the canvas anchors the note to that node with a connector, auto-placing it beside the frame. body is markdown-lite.",
      inputSchema: {
        boardId: z.string(),
        x: z.number().optional().describe("Board x; required unless `attachment` is given"),
        y: z.number().optional().describe("Board y; required unless `attachment` is given"),
        width: z.number().positive().optional().describe("Pixel width; default 240"),
        body: z.string(),
        attachment: z
          .object({
            frameId: z.string().describe("Frame on this board that shows the screen"),
            screenId: z.string(),
            locator: PathSchema,
          })
          .optional()
          .describe("Anchor the note to a node instead of free board space"),
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
        path: PathSchema,
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
    "update_annotation",
    {
      description:
        "Edit one of your own annotations — its body, or `collapsed` (null clears the override). Refuses user-authored ones: those are the designer's channel to you, so answer them with your own annotation rather than rewriting theirs.",
      inputSchema: {
        screenId: z.string(),
        annotationId: z.string(),
        body: z.string().optional(),
        collapsed: z.boolean().nullable().optional(),
      },
    },
    async ({ screenId, annotationId, body, collapsed }) => {
      if (body === undefined && collapsed === undefined) {
        return errorResult(badRequest("update_annotation: pass body, collapsed, or both."));
      }
      const existing = ctx.folder.annotations.get(screenId)?.find((a) => a.id === annotationId);
      if (existing && existing.author !== "agent") {
        return errorResult(
          badRequest(
            `Annotation ${annotationId} is user-authored — agents may only edit their own.`,
          ),
        );
      }
      return toMcp(
        await updateAnnotation(ctx, {
          screenId,
          annotationId,
          patch: {
            ...(body !== undefined ? { body } : {}),
            ...(collapsed !== undefined ? { collapsed } : {}),
          },
        }),
      );
    },
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
        return errorResult(
          badRequest(
            `Annotation ${annotationId} is user-authored — agents may only remove their own.`,
          ),
        );
      }
      return toMcp(await removeAnnotation(ctx, { screenId, annotationId }));
    },
  );
}
