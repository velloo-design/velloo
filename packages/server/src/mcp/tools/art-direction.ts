import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  DirectionPatchSchema,
  GenerateArtDirectionBodySchema,
  UpdateArtDirectionBodySchema,
} from "@velloo/protocol";
import type { ArtDirectionFile } from "@velloo/schema";
import { z } from "zod";
import {
  artDirectionState,
  generateArtDirection,
  updateArtDirection,
} from "../../art-direction/art-direction.ts";
import { nextStep } from "../../art-direction/next.ts";
import type { CloudAuth } from "../../cloud.ts";
import type { MutationContext } from "../../mutations/index.ts";
import { errorResult, jsonResult, type McpContent, type McpResult, toMcp } from "./result.ts";

/**
 * The art direction: a design's look explored in images before it is built. The
 * agent writes the brief and the directions and draws the images; the person
 * narrows them on the canvas (`?view=art-direction`). Guide: velloo://guide/art-direction.
 */

/** The art direction with each image's file on disk, which the agent opens to look at it. */
function withFiles(root: string, artDirection: ArtDirectionFile) {
  const file = (path: string) => join(root, path);
  return {
    ...artDirection,
    directions: artDirection.directions.map((d) => ({
      ...d,
      boards: d.boards.map((b) => ({ ...b, file: file(b.path) })),
      mocks: d.mocks.map((m) => ({ ...m, file: file(m.path) })),
    })),
    ...(artDirection.chosen
      ? { chosen: { ...artDirection.chosen, file: file(artDirection.chosen.mock) } }
      : {}),
  };
}

/** An image inlined in the result is capped: a mood board can be several megabytes. */
const MAX_INLINE_BYTES = 3 * 1024 * 1024;

export function registerArtDirectionTools(
  mcp: McpServer,
  ctx: MutationContext,
  cloud: CloudAuth | undefined,
  canvasUrl?: string,
): void {
  mcp.registerTool(
    "get_art_direction",
    {
      description:
        "Read the art direction: the brief, the directions, their mood boards and mocks (each with its `file` on disk: open it to look), the mock chosen to build from, whether the build may draw paid images, and `next`, what to do now. Guide: velloo://guide/art-direction.",
      inputSchema: {
        inline: z
          .array(z.string())
          .max(3)
          .optional()
          .describe("Image paths to return as images too, for a client that can't open files."),
      },
    },
    async (args): Promise<McpResult> => {
      const state = await artDirectionState(ctx.folder.root);
      const images: McpContent[] = [];
      for (const path of args.inline ?? []) {
        const known = state.artDirection.directions.some((d) =>
          [...d.boards, ...d.mocks].some((i) => i.path === path),
        );
        if (!known)
          return errorResult(`get_art_direction: "${path}" isn't an art direction image.`);
        const bytes = await readFile(join(ctx.folder.root, path)).catch(() => null);
        if (!bytes) return errorResult(`get_art_direction: "${path}" is missing on disk.`);
        if (bytes.length > MAX_INLINE_BYTES) {
          return errorResult(
            `get_art_direction: "${path}" is ${(bytes.length / 1048576).toFixed(1)} MB, too large to inline; open its file instead.`,
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
        artDirection: withFiles(ctx.folder.root, state.artDirection),
        next: nextStep(state, canvasUrl),
      };
      return { content: [{ type: "text", text: JSON.stringify(body) }, ...images] };
    },
  );

  mcp.registerTool(
    "update_art_direction",
    {
      description:
        "Write the art direction: the brief (product, page, its real copy top to bottom), directions to add or change by id (a new one needs `title` and `description`, the look in words an image model can draw: palette with hex values, type, texture, imagery, motifs; plus `layout`, how the page is arranged in it), the stage and the chosen mock. The canvas follows every write.",
      inputSchema: {
        ...UpdateArtDirectionBodySchema.omit({ agentSession: true }).shape,
        directions: z
          .array(DirectionPatchSchema)
          .max(12)
          .optional()
          .describe("Upserts by id (a lowercase slug). Drop one with { id, dropped: true }."),
      },
    },
    async (args) => {
      const r = await updateArtDirection(
        ctx,
        UpdateArtDirectionBodySchema.omit({ agentSession: true }).parse(args),
      );
      if (!r.ok) return toMcp(r);
      const state = await artDirectionState(ctx.folder.root);
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
    "generate_art_direction",
    {
      description:
        "Draw art direction images through velloo-cloud: a mood board per direction, or mocks per picked direction (drawn from its mood board when there is one). **PAY-AS-YOU-GO against the user's credits**: relay the returned cost and balance. The person usually starts these from the canvas; draw them yourself when asked to. Pass `model` only when the person picked one.",
      inputSchema: GenerateArtDirectionBodySchema.shape,
    },
    async (args) => {
      const r = await generateArtDirection(ctx, cloud, GenerateArtDirectionBodySchema.parse(args));
      if (!r.ok) return toMcp(r);
      return jsonResult({
        ...r.value,
        next: nextStep(await artDirectionState(ctx.folder.root), canvasUrl),
      });
    },
  );
}
