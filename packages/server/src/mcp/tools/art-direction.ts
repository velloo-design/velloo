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
  createArtDirection,
  generateArtDirection,
  listArtDirections,
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
    chosen: artDirection.chosen.map((c) => ({ ...c, file: file(c.image) })),
  };
}

const ID_ARG = z
  .string()
  .optional()
  .describe("Which art direction; default the one changed last. `others` lists the rest.");

/** The art direction a call means: the one named, else the one changed last. */
async function resolveId(root: string, id: string | undefined): Promise<string | null> {
  return id ?? (await listArtDirections(root))[0]?.id ?? null;
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
        "Read the art direction: the brief, the directions, their mood boards and mocks (each with its `file` on disk: open it to look), the images chosen to design screens from, whether those screens may draw paid images, and `next`, what to do now. Guide: velloo://guide/art-direction.",
      inputSchema: {
        id: ID_ARG,
        inline: z
          .array(z.string())
          .max(3)
          .optional()
          .describe("Image paths to return as images too, for a client that can't open files."),
      },
    },
    async (args): Promise<McpResult> => {
      const root = ctx.folder.root;
      const id = await resolveId(root, args.id);
      const state = id ? await artDirectionState(root, id) : null;
      if (!state) {
        return args.id
          ? errorResult(`get_art_direction: there's no art direction "${args.id}".`)
          : jsonResult({
              artDirection: null,
              next: "There's no art direction yet. The person starts one on the canvas (?view=art-direction); write to one with update_art_direction, which starts one when there is none.",
            });
      }
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
      const others = (await listArtDirections(root))
        .filter((o) => o.id !== state.id)
        .map((o) => ({ id: o.id, name: o.name, stage: o.stage }));
      const body = {
        ...state,
        artDirection: withFiles(root, state.artDirection),
        ...(others.length ? { others } : {}),
        next: nextStep(state, canvasUrl),
      };
      return { content: [{ type: "text", text: JSON.stringify(body) }, ...images] };
    },
  );

  mcp.registerTool(
    "update_art_direction",
    {
      description:
        "Write the art direction: the brief (product, page, its real copy top to bottom), directions to add or change by id (a new one needs `title` and `description`, the look in words an image model can draw: palette with hex values, type, texture, imagery, motifs; plus `layout`, how the page is arranged in it), the stage and the chosen images. The canvas follows every write.",
      inputSchema: {
        id: ID_ARG,
        ...UpdateArtDirectionBodySchema.omit({ agentSession: true }).shape,
        directions: z
          .array(DirectionPatchSchema)
          .max(12)
          .optional()
          .describe("Upserts by id (a lowercase slug). Drop one with { id, dropped: true }."),
      },
    },
    async ({ id: named, ...args }) => {
      const root = ctx.folder.root;
      const body = UpdateArtDirectionBodySchema.omit({ agentSession: true }).parse(args);
      let id = await resolveId(root, named);
      if (!id) {
        const made = await createArtDirection(ctx, {});
        if (!made.ok) return toMcp(made);
        id = made.value.id;
      }
      const r = await updateArtDirection(ctx, id, body);
      if (!r.ok) return toMcp(r);
      const state = await artDirectionState(root, id);
      return jsonResult({
        id,
        stage: r.value.stage,
        directions: r.value.directions.map((d) => ({
          id: d.id,
          title: d.title,
          dropped: d.dropped,
        })),
        ...(state ? { next: nextStep(state, canvasUrl) } : {}),
      });
    },
  );

  mcp.registerTool(
    "generate_art_direction",
    {
      description:
        "Draw art direction images through velloo-cloud: a mood board per direction, mocks per picked direction (drawn from its mood board when there is one), or new versions of one mock with a change (`revise`). **PAY-AS-YOU-GO against the user's credits**: relay the returned cost and balance. The person usually starts these from the canvas; draw them yourself when asked to. Pass `model` only when the person picked one.",
      inputSchema: { id: ID_ARG, ...GenerateArtDirectionBodySchema.shape },
    },
    async ({ id: named, ...args }) => {
      const root = ctx.folder.root;
      const id = await resolveId(root, named);
      if (!id) return errorResult("generate_art_direction: there's no art direction yet.");
      const r = await generateArtDirection(
        ctx,
        cloud,
        id,
        GenerateArtDirectionBodySchema.parse(args),
      );
      if (!r.ok) return toMcp(r);
      const state = await artDirectionState(root, id);
      return jsonResult({ ...r.value, ...(state ? { next: nextStep(state, canvasUrl) } : {}) });
    },
  );
}
