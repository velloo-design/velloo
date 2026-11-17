import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  DirectionPatchSchema,
  GenerateSketchbookBodySchema,
  ReferencePatchSchema,
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

/** The directions whose proposal has pairs under AA, which `next` tells the agent to fix. */
function failingAA(ctx: MutationContext, sketchbook: SketchbookFile): string[] {
  return sketchbook.directions.flatMap((d) => {
    if (d.dropped || !d.proposal) return [];
    const under = underAA(ctx, d.proposal);
    return Array.isArray(under) && under.length > 0 ? [d.id] : [];
  });
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
    outputs: sketchbook.outputs.map((o) => ({ ...o, ...outputStatus(sketchbook, o) })),
  };
}

const ID_ARG = z.string().optional().describe("Which sketchbook; default the one changed last");

/**
 * What the agent writes. The rest is the person's to set on the canvas: the
 * page and origin they start from, their model, inspiration, mock and paid-image picks,
 * the Agent-tab session and a pasted image's data.
 */
const AGENT_UPDATE = UpdateSketchbookBodySchema.omit({
  agentSession: true,
  models: true,
  inspiration: true,
  mockCount: true,
  screenCount: true,
  generateImages: true,
  origin: true,
  page: true,
  references: true,
}).shape;
const AGENT_REFERENCE = ReferencePatchSchema.omit({ data: true });

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
        "Read the sketchbook: the brief, the person's `references`, the directions and their images (each with its `file` on disk: open it to look), the `kinds` the cloud draws, and `next`, what to do now. Guide: velloo://guide/sketchbook.",
      inputSchema: {
        id: ID_ARG,
        inline: z.array(z.string()).max(3).optional().describe("Image paths to also return inline"),
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
        next: nextStep(state, canvasUrl, failingAA(ctx, state.sketchbook)),
      };
      return { content: [{ type: "text", text: JSON.stringify(body) }, ...images] };
    },
  );

  mcp.registerTool(
    "update_sketchbook",
    {
      description:
        "Write the sketchbook, starting one if there is none: the `brief` (product, page, its real copy top to bottom), `directions` (a new one needs `title`, `description` — the look in words an image model can draw, palette in hex — and `layout`), `stage`, `references` the person likes (`{ url | path, note }`) and `remix: { from: [a, b], take }`. Each direction's `proposal` (set_theme's tokens + fonts) is answered with its pairs under AA.",
      inputSchema: {
        id: ID_ARG,
        ...AGENT_UPDATE,
        directions: z
          .array(DirectionPatchSchema)
          .max(12)
          .optional()
          .describe("Upserted by id; `{ id, dropped: true }` drops one"),
        references: z.array(AGENT_REFERENCE).max(12).optional(),
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
        ...(state ? { next: nextStep(state, canvasUrl, failingAA(ctx, state.sketchbook)) } : {}),
      });
    },
  );

  mcp.registerTool(
    "generate_sketchbook",
    {
      description:
        "Draw sketchbook images — **paid from the user's credits**: relay the returned cost and balance. `kind` is moodboard, mock or another of get_sketchbook's `kinds`; `revise: { image, instruction }` redraws one image with a change. The person usually draws from the canvas: do it when asked, and pass `model` only when they picked one.",
      inputSchema: { id: ID_ARG, ...GenerateSketchbookBodySchema.shape },
    },
    async ({ id: named, ...args }) => {
      const root = ctx.folder.root;
      const id = await resolveId(root, named);
      if (!id) return errorResult("generate_sketchbook: there's no sketchbook yet.");
      const r = await generateSketchbook(ctx, cloud, id, GenerateSketchbookBodySchema.parse(args));
      if (!r.ok) return toMcp(r);
      const state = await sketchbookState(root, id);
      return jsonResult({
        ...r.value,
        ...(state ? { next: nextStep(state, canvasUrl, failingAA(ctx, state.sketchbook)) } : {}),
      });
    },
  );
}
