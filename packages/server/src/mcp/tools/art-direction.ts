import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  type ArtDirectionState,
  DirectionPatchSchema,
  GenerateArtDirectionBodySchema,
  UpdateArtDirectionBodySchema,
} from "@velloo/protocol";
import { type ArtDirectionFile, activeDirections } from "@velloo/schema";
import { z } from "zod";
import {
  artDirectionState,
  generateArtDirection,
  updateArtDirection,
} from "../../art-direction/art-direction.ts";
import type { CloudAuth } from "../../cloud.ts";
import type { MutationContext } from "../../mutations/index.ts";
import { errorResult, jsonResult, type McpContent, type McpResult, toMcp } from "./result.ts";

/**
 * The art direction: a design's look explored in images before it is built. The
 * agent writes the brief and the directions and draws the images; the person
 * narrows them on the canvas (`?view=art-direction`). Guide: velloo://guide/art-direction.
 */

/** What the agent should do next, from where the art direction stands. */
function nextStep(state: ArtDirectionState, canvasUrl?: string): string {
  const { artDirection } = state;
  const at = canvasUrl ? ` (${canvasUrl}/?view=art-direction)` : "";
  if (!artDirection.brief) {
    return "Write the brief: for an existing app read the page from the codebase (its real copy, top to bottom); for a new one ask the person what they're building, then update_art_direction { brief }.";
  }
  const active = activeDirections(artDirection);
  switch (artDirection.stage) {
    case "brief":
    case "directions":
      return active.length === 0
        ? "Propose three directions that differ from each other and from what the app has (update_art_direction { directions }), then ask the person to narrow them on the canvas."
        : `Ask the person to drop or edit directions on the canvas${at}, then draw a mood board per direction (generate_art_direction { kind: "moodboard" }), unless they skip mood boards.`;
    case "boards":
      return `Ask the person to pick mood boards and a mock count on the canvas${at}, then draw the mocks (generate_art_direction { kind: "mock" }).`;
    case "mocks":
      return artDirection.chosen
        ? "Build the design from the chosen mock."
        : `Ask the person to choose one mock on the canvas${at}; it becomes the design you build.`;
    case "build":
      return `Build the chosen mock on the canvas: look at the image, compose the screen from the app's own components and the design's rules, and treat facts in the mock that aren't in the brief as sample data. ${
        artDirection.generateImages === true
          ? "The person allowed paid images: draw the photographs and illustrations the mock shows with generate_asset, and relay the cost."
          : artDirection.generateImages === false
            ? "The person declined paid images: author simple art with upload_asset or leave clear placeholders."
            : "Ask the person before drawing any image with generate_asset: it costs credits."
      }`;
  }
}

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
        ...UpdateArtDirectionBodySchema.shape,
        directions: z
          .array(DirectionPatchSchema)
          .max(12)
          .optional()
          .describe("Upserts by id (a lowercase slug). Drop one with { id, dropped: true }."),
      },
    },
    async (args) => {
      const r = await updateArtDirection(ctx, UpdateArtDirectionBodySchema.parse(args));
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
