import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { UpdateLookBodySchema } from "@velloo/protocol";
import type { Look } from "@velloo/schema";
import type { MutationContext } from "../../mutations/index.ts";
import { lookFromSketchbook, updateLook } from "../../theme/looks.ts";
import { errorResult, jsonResult } from "./result.ts";

/** A Look as the agent reads it: each image with its `file` on disk, to open and look at. */
export function lookWithFiles(root: string, look: Look | null) {
  if (!look) return null;
  return { ...look, images: look.images.map((i) => ({ ...i, file: join(root, i.path) })) };
}

/** What to do after a Look is made from a sketchbook direction: the images still have to become its tokens and words. */
const AFTER_SKETCHBOOK = (name: string) =>
  `The Look "${name}" holds the direction's images, and its tokens are still a copy. Open the images, then set its colours, faces and radius from them (set_theme { theme: "${name}" }), and write its rules and imagery note (update_look { theme: "${name}", rules, imagery }). Pin it to a board with update_board { patch: { theme } }.`;

/**
 * Looks: a theme's tokens plus its imagery, rules and origin. Reading one is
 * `get_theme`'s; this is the one write. Guide: velloo://guide/sketchbook.
 */
export function registerLookTools(mcp: McpServer, ctx: MutationContext): void {
  mcp.registerTool(
    "update_look",
    {
      description:
        "Write a Look: a theme's imagery (images with a kind), its own do's and don'ts (layered over the design's rules), its imagery note and one-line description. `fromSketchbook` makes one from a sketchbook direction; then set its tokens with set_theme from the images. Tokens are set_theme's; get_theme reads the Look.",
      inputSchema: UpdateLookBodySchema.shape,
    },
    async (raw) => {
      const { theme, fromSketchbook, ...patch } = UpdateLookBodySchema.parse(raw);
      if (fromSketchbook) {
        const r = await lookFromSketchbook(ctx, fromSketchbook, theme, patch);
        if (!r.ok) return errorResult(r.error);
        return jsonResult({
          theme: r.value.name,
          created: r.value.created,
          look: lookWithFiles(ctx.folder.root, r.value.look),
          next: AFTER_SKETCHBOOK(r.value.name),
        });
      }
      const name = theme ?? "default";
      const r = await updateLook(ctx, name, patch);
      if (!r.ok) return errorResult(r.error);
      return jsonResult({ theme: name, look: lookWithFiles(ctx.folder.root, r.value) });
    },
  );
}
