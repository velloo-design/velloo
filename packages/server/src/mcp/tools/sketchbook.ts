import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  DirectionPatchSchema,
  GenerateSketchbookBodySchema,
  UpdateSketchbookBodySchema,
} from "@velloo/protocol";
import type { SketchbookFile } from "@velloo/schema";
import { z } from "zod";
import type { CloudAuth } from "../../cloud.ts";
import type { MutationContext } from "../../mutations/index.ts";
import { outputStatus } from "../../sketchbook/links.ts";
import { nextStep } from "../../sketchbook/next.ts";
import {
  createSketchbook,
  generateSketchbook,
  listSketchbooks,
  sketchbookState,
  updateSketchbook,
} from "../../sketchbook/sketchbook.ts";
import { errorResult, jsonResult, type McpContent, type McpResult, toMcp } from "./result.ts";

/**
 * The sketchbook: a design's look explored in images before it is built. The
 * agent writes the brief and the directions and draws the images; the person
 * narrows them on the canvas (`?view=sketchbook`). Guide: velloo://guide/sketchbook.
 */

/** The sketchbook with each image's file on disk, which the agent opens to look at it. */
function withFiles(root: string, sketchbook: SketchbookFile) {
  const file = (path: string) => join(root, path);
  return {
    ...sketchbook,
    directions: sketchbook.directions.map((d) => ({
      ...d,
      boards: d.boards.map((b) => ({ ...b, file: file(b.path) })),
      mocks: d.mocks.map((m) => ({ ...m, file: file(m.path) })),
    })),
    chosen: sketchbook.chosen.map((c) => ({ ...c, file: file(c.image) })),
    outputs: sketchbook.outputs.map((o) => ({ ...o, ...outputStatus(sketchbook, o) })),
  };
}

const ID_ARG = z
  .string()
  .optional()
  .describe("Which sketchbook; default the one changed last. `others` lists the rest.");

/** The sketchbook a call means: the one named, else the one changed last. */
async function resolveId(root: string, id: string | undefined): Promise<string | null> {
  return id ?? (await listSketchbooks(root))[0]?.id ?? null;
}

/** An image inlined in the result is capped: a mood board can be several megabytes. */
const MAX_INLINE_BYTES = 3 * 1024 * 1024;

export function registerSketchbookTools(
  mcp: McpServer,
  ctx: MutationContext,
  cloud: CloudAuth | undefined,
  canvasUrl?: string,
): void {
  mcp.registerTool(
    "get_sketchbook",
    {
      description:
        "Read the sketchbook: the brief, the directions, their mood boards and mocks (each with its `file` on disk: open it to look), the images chosen to design screens from, whether those screens may draw paid images, and `next`, what to do now. Guide: velloo://guide/sketchbook.",
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
      const state = id ? await sketchbookState(root, id) : null;
      if (!state) {
        return args.id
          ? errorResult(`get_sketchbook: there's no sketchbook "${args.id}".`)
          : jsonResult({
              sketchbook: null,
              next: "There's no sketchbook yet. The person starts one on the canvas (?view=sketchbook); write to one with update_sketchbook, which starts one when there is none.",
            });
      }
      const images: McpContent[] = [];
      for (const path of args.inline ?? []) {
        const known = state.sketchbook.directions.some((d) =>
          [...d.boards, ...d.mocks].some((i) => i.path === path),
        );
        if (!known) return errorResult(`get_sketchbook: "${path}" isn't a sketchbook image.`);
        const bytes = await readFile(join(ctx.folder.root, path)).catch(() => null);
        if (!bytes) return errorResult(`get_sketchbook: "${path}" is missing on disk.`);
        if (bytes.length > MAX_INLINE_BYTES) {
          return errorResult(
            `get_sketchbook: "${path}" is ${(bytes.length / 1048576).toFixed(1)} MB, too large to inline; open its file instead.`,
          );
        }
        images.push({
          type: "image",
          data: bytes.toString("base64"),
          mimeType: /\.jpe?g$/i.test(path) ? "image/jpeg" : "image/png",
        });
      }
      const others = (await listSketchbooks(root))
        .filter((o) => o.id !== state.id)
        .map((o) => ({ id: o.id, name: o.name, stage: o.stage }));
      const body = {
        ...state,
        sketchbook: withFiles(root, state.sketchbook),
        ...(others.length ? { others } : {}),
        next: nextStep(state, canvasUrl),
      };
      return { content: [{ type: "text", text: JSON.stringify(body) }, ...images] };
    },
  );

  mcp.registerTool(
    "update_sketchbook",
    {
      description:
        "Write the sketchbook: the brief (product, page, its real copy top to bottom), directions to add or change by id (a new one needs `title` and `description`, the look in words an image model can draw: palette with hex values, type, texture, imagery, motifs; plus `layout`, how the page is arranged in it), the stage and the chosen images. The canvas follows every write.",
      inputSchema: {
        id: ID_ARG,
        ...UpdateSketchbookBodySchema.omit({ agentSession: true }).shape,
        directions: z
          .array(DirectionPatchSchema)
          .max(12)
          .optional()
          .describe("Upserts by id (a lowercase slug). Drop one with { id, dropped: true }."),
      },
    },
    async ({ id: named, ...args }) => {
      const root = ctx.folder.root;
      const body = UpdateSketchbookBodySchema.omit({ agentSession: true }).parse(args);
      let id = await resolveId(root, named);
      if (!id) {
        const made = await createSketchbook(ctx, {});
        if (!made.ok) return toMcp(made);
        id = made.value.id;
      }
      const r = await updateSketchbook(ctx, id, body);
      if (!r.ok) return toMcp(r);
      const state = await sketchbookState(root, id);
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
    "generate_sketchbook",
    {
      description:
        "Draw sketchbook images through velloo-cloud: a mood board per direction, mocks per picked direction (drawn from its mood board when there is one), or new versions of one mock with a change (`revise`). **PAY-AS-YOU-GO against the user's credits**: relay the returned cost and balance. The person usually starts these from the canvas; draw them yourself when asked to. Pass `model` only when the person picked one.",
      inputSchema: { id: ID_ARG, ...GenerateSketchbookBodySchema.shape },
    },
    async ({ id: named, ...args }) => {
      const root = ctx.folder.root;
      const id = await resolveId(root, named);
      if (!id) return errorResult("generate_sketchbook: there's no sketchbook yet.");
      const r = await generateSketchbook(ctx, cloud, id, GenerateSketchbookBodySchema.parse(args));
      if (!r.ok) return toMcp(r);
      const state = await sketchbookState(root, id);
      return jsonResult({ ...r.value, ...(state ? { next: nextStep(state, canvasUrl) } : {}) });
    },
  );
}
