import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  DirectionPatchSchema,
  GenerateLookbookBodySchema,
  type LookbookState,
  UpdateLookbookBodySchema,
} from "@velloo/protocol";
import { activeDirections, type LookbookFile } from "@velloo/schema";
import { z } from "zod";
import type { CloudAuth } from "../../cloud.ts";
import { generateLookbook, lookbookState, updateLookbook } from "../../lookbook/lookbook.ts";
import type { MutationContext } from "../../mutations/index.ts";
import { errorResult, jsonResult, type McpContent, type McpResult, toMcp } from "./result.ts";

/**
 * The lookbook: a design's look explored in images before it is built. The
 * agent writes the brief and the directions and draws the images; the person
 * narrows them on the canvas (`?view=lookbook`). Guide: velloo://guide/lookbook.
 */

/** What the agent should do next, from where the lookbook stands. */
function nextStep(state: LookbookState, canvasUrl?: string): string {
  const { lookbook } = state;
  const at = canvasUrl ? ` (${canvasUrl}/?view=lookbook)` : "";
  if (lookbook.requests.length > 0) {
    return `The person left ${lookbook.requests.length} request(s) on the canvas: act on each, then clear it with update_lookbook { resolveRequests: [ids] }.`;
  }
  if (!lookbook.brief) {
    return "Write the brief: for an existing app read the page from the codebase (its real copy, top to bottom); for a new one ask the person what they're building, then update_lookbook { brief }.";
  }
  const active = activeDirections(lookbook);
  switch (lookbook.stage) {
    case "brief":
    case "directions":
      return active.length === 0
        ? "Propose three directions that differ from each other and from what the app has (update_lookbook { directions }), then ask the person to narrow them on the canvas."
        : `Ask the person to drop or edit directions on the canvas${at}, then draw a mood board per direction (generate_lookbook { kind: "moodboard" }), unless they skip mood boards.`;
    case "boards":
      return `Ask the person to pick mood boards and a mock count on the canvas${at}, then draw the mocks (generate_lookbook { kind: "mock" }).`;
    case "mocks":
      return lookbook.chosen
        ? "Build the design from the chosen mock."
        : `Ask the person to choose one mock on the canvas${at}; it becomes the design you build.`;
    case "build":
      return "Build the chosen mock on the canvas: look at the image, compose the screen from the app's own components and the design's rules, and treat facts in the mock that aren't in the brief as sample data.";
  }
}

/** The lookbook with each image's file on disk, which the agent opens to look at it. */
function withFiles(root: string, lookbook: LookbookFile) {
  const file = (path: string) => join(root, path);
  return {
    ...lookbook,
    directions: lookbook.directions.map((d) => ({
      ...d,
      boards: d.boards.map((b) => ({ ...b, file: file(b.path) })),
      mocks: d.mocks.map((m) => ({ ...m, file: file(m.path) })),
    })),
    ...(lookbook.chosen
      ? { chosen: { ...lookbook.chosen, file: file(lookbook.chosen.mock) } }
      : {}),
  };
}

/** An image inlined in the result is capped: a mood board can be several megabytes. */
const MAX_INLINE_BYTES = 3 * 1024 * 1024;

export function registerLookbookTools(
  mcp: McpServer,
  ctx: MutationContext,
  cloud: CloudAuth | undefined,
  canvasUrl?: string,
): void {
  mcp.registerTool(
    "get_lookbook",
    {
      description:
        "Read the lookbook: the brief, the directions, their mood boards and mocks (each with its `file` on disk: open it to look), the mock chosen to build from, requests the person left on the canvas, and `next`, what to do now. Guide: velloo://guide/lookbook.",
      inputSchema: {
        inline: z
          .array(z.string())
          .max(3)
          .optional()
          .describe("Image paths to return as images too, for a client that can't open files."),
      },
    },
    async (args): Promise<McpResult> => {
      const state = await lookbookState(ctx.folder.root);
      const images: McpContent[] = [];
      for (const path of args.inline ?? []) {
        const known = state.lookbook.directions.some((d) =>
          [...d.boards, ...d.mocks].some((i) => i.path === path),
        );
        if (!known) return errorResult(`get_lookbook: "${path}" isn't a lookbook image.`);
        const bytes = await readFile(join(ctx.folder.root, path)).catch(() => null);
        if (!bytes) return errorResult(`get_lookbook: "${path}" is missing on disk.`);
        if (bytes.length > MAX_INLINE_BYTES) {
          return errorResult(
            `get_lookbook: "${path}" is ${(bytes.length / 1048576).toFixed(1)} MB, too large to inline; open its file instead.`,
          );
        }
        images.push({
          type: "image",
          data: bytes.toString("base64"),
          mimeType: /\.jpe?g$/i.test(path) ? "image/jpeg" : "image/png",
        });
      }
      const body = {
        ...state,
        lookbook: withFiles(ctx.folder.root, state.lookbook),
        next: nextStep(state, canvasUrl),
      };
      return { content: [{ type: "text", text: JSON.stringify(body) }, ...images] };
    },
  );

  mcp.registerTool(
    "update_lookbook",
    {
      description:
        "Write the lookbook: the brief (product, page, its real copy top to bottom), directions to add or change by id (a new one needs `title` and `description`, the look in words an image model can draw: palette with hex values, type, texture, imagery, motifs; plus `layout`, how the page is arranged in it), the stage, the chosen mock, and clearing requests you acted on. The canvas follows every write.",
      inputSchema: {
        ...UpdateLookbookBodySchema.shape,
        directions: z
          .array(DirectionPatchSchema)
          .max(12)
          .optional()
          .describe("Upserts by id (a lowercase slug). Drop one with { id, dropped: true }."),
      },
    },
    async (args) => {
      const r = await updateLookbook(ctx, UpdateLookbookBodySchema.parse(args));
      if (!r.ok) return toMcp(r);
      const state = await lookbookState(ctx.folder.root);
      return jsonResult({
        stage: r.value.stage,
        directions: r.value.directions.map((d) => ({
          id: d.id,
          title: d.title,
          dropped: d.dropped,
        })),
        next: nextStep(state, canvasUrl),
      });
    },
  );

  mcp.registerTool(
    "generate_lookbook",
    {
      description:
        "Draw lookbook images through velloo-cloud: a mood board per direction, or mocks per picked direction (drawn from its mood board when there is one). **PAY-AS-YOU-GO against the user's credits**: relay the returned cost and balance. The person usually starts these from the canvas; draw them yourself when asked to. Pass `model` only when the person picked one.",
      inputSchema: GenerateLookbookBodySchema.shape,
    },
    async (args) => {
      const r = await generateLookbook(ctx, cloud, GenerateLookbookBodySchema.parse(args));
      if (!r.ok) return toMcp(r);
      return jsonResult({
        ...r.value,
        next: nextStep(await lookbookState(ctx.folder.root), canvasUrl),
      });
    },
  );
}
