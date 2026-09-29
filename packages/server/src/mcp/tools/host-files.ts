import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { type MutationContext, storeHostFiles } from "../../mutations/index.ts";
import { toMcp } from "./result.ts";

export function registerHostFileTools(mcp: McpServer, ctx: MutationContext): void {
  mcp.registerTool(
    "store_host_files",
    {
      description:
        "HTML designs: copy the app's own stylesheets — and the images and fonts they and the design's nodes name by app path — into the design, which shows those copies to everyone, with no app running. from: \"source\" reads the app's files on disk; { captureId } reads a page captured with start_capture_session, including built CSS that isn't on disk. Run again after the app's CSS changes.",
      inputSchema: {
        from: z.union([z.literal("source"), z.object({ captureId: z.string() })]),
        stylesheets: z
          .array(z.string())
          .optional()
          .describe(
            "The app's stylesheets in cascade order (/static/site.css or https URLs). Default: the ones the captured page linked, else the design's current list.",
          ),
      },
    },
    async (args) => toMcp(await storeHostFiles(ctx, args)),
  );
}
