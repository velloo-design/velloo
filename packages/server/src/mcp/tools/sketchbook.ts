import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  DirectionPatchSchema,
  GenerateSketchbookBodySchema,
  UpdateSketchbookBodySchema,
} from "@velloo/protocol";
import { findSketchbookImage, type SketchbookFile, type SketchbookProposal } from "@velloo/schema";
import { z } from "zod";
import type { CloudAuth } from "../../cloud.ts";
import { fetchSketchbookKinds } from "../../cloud-generate.ts";
import { themeByName } from "../../design-folder.ts";
import type { MutationContext } from "../../mutations/index.ts";
import { outputStatus } from "../../sketchbook/links.ts";
import { nextStep } from "../../sketchbook/next.ts";
import { PROMPTED_KINDS } from "../../sketchbook/prompts.ts";
import {
  createSketchbook,
  generateSketchbook,
  listSketchbooks,
  sketchbookState,
  updateSketchbook,
} from "../../sketchbook/sketchbook.ts";
import { describeProposalError, failingPairs, proposalContrast } from "../../theme/proposal.ts";
import { errorResult, jsonResult, type McpContent, type McpResult, toMcp } from "./result.ts";

/**
 * The sketchbook: a design's look explored in images before it is built. The
 * agent writes the brief and the directions and draws the images; the person
 * narrows them on the canvas (`?view=sketchbook`). Guide: velloo://guide/sketchbook.
 */

/**
 * A proposal's colour pairs under AA, as the agent fixes them: scored on the
 * design's theme with the proposal applied, the way score_theme_contrast scores.
 */
function underAA(ctx: MutationContext, proposal: SketchbookProposal) {
  const scored = proposalContrast(themeByName(ctx.folder), proposal);
  if (!scored.ok) return { problem: describeProposalError(scored.error) };
  return failingPairs(scored.value).map((p) => ({ pair: p.label, mode: p.mode, ratio: p.ratio }));
}

/** The sketchbook with each image's file on disk, which the agent opens to look at it. */
function withFiles(ctx: MutationContext, sketchbook: SketchbookFile) {
  const file = (path: string) => join(ctx.folder.root, path);
  return {
    ...sketchbook,
    directions: sketchbook.directions.map((d) => ({
      ...d,
      images: d.images.map((i) => ({ ...i, file: file(i.path) })),
      ...(d.proposal ? { underAA: underAA(ctx, d.proposal) } : {}),
    })),
    references: sketchbook.references.map((r) => ({ ...r, file: file(r.path) })),
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
        "Read the sketchbook: the brief, the person's `references` (screenshots they like, each with its `file`), the directions, their images by `kind` (each with its `file` on disk: open it to look), the `kinds` the cloud draws, the images chosen to design screens from, whether those screens may draw paid images, and `next`, what to do now. Guide: velloo://guide/sketchbook.",
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
        const known =
          findSketchbookImage(state.sketchbook, path) !== undefined ||
          state.sketchbook.references.some((r) => r.path === path);
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
      const { kinds } = await fetchSketchbookKinds(cloud, PROMPTED_KINDS);
      const body = {
        ...state,
        sketchbook: withFiles(ctx, state.sketchbook),
        kinds: kinds.map((k) => ({ kind: k.intent, label: k.label, aspects: k.aspects })),
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
        "Write the sketchbook: the brief (product, page, its real copy top to bottom), directions to add or change by id (a new one needs `title` and `description`, the look in words an image model can draw: palette with hex values, type, texture, imagery, motifs; plus `layout`, how the page is arranged in it), the stage and the chosen images. A Look sketchbook (`subject: \"look\"`) takes a direction's `proposal` (tokens + fonts as set_theme takes them) and answers its pairs under AA. `references` adds screenshots the person likes (`{ url | path, note }`: a URL is screenshotted, a path is an asset), notes or removes them by id; a direction's `references` names the ones it is drawn from. `remix: { from: [a, b], take }` makes a direction from two. The canvas follows every write.",
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
      const proposed = new Set(body.directions?.filter((p) => p.proposal).map((p) => p.id));
      return jsonResult({
        id,
        stage: r.value.stage,
        directions: r.value.directions.map((d) => ({
          id: d.id,
          title: d.title,
          dropped: d.dropped,
          ...(d.proposal && proposed.has(d.id) ? { underAA: underAA(ctx, d.proposal) } : {}),
        })),
        ...(state ? { next: nextStep(state, canvasUrl) } : {}),
      });
    },
  );

  mcp.registerTool(
    "generate_sketchbook",
    {
      description:
        "Draw sketchbook images through velloo-cloud: a mood board per direction, mocks per picked direction (drawn from its mood board when there is one), another of the `kinds` get_sketchbook lists (palette, typeposter, uikit, imagery, icons, mobile, detail; also from the mood board), or new versions of any one image with a change (`revise: { image, instruction }`). **PAY-AS-YOU-GO against the user's credits**: relay the returned cost and balance. The person usually starts these from the canvas; draw them yourself when asked to. Pass `model` only when the person picked one.",
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
