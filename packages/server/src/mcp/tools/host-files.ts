import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { type MutationContext, storeHostFiles } from "../../mutations/index.ts";
import { toMcp } from "./result.ts";

export function registerHostFileTools(mcp: McpServer, ctx: MutationContext): void {
  mcp.registerTool(
    "store_host_files",
    {
      description:
        "Copy the app's stylesheets, and the images and fonts they and the nodes name, into the design so it renders with no app running. `from: \"source\"` reads the app's files; `{ captureId }` a captured page, built CSS included. Rerun after the app's CSS changes.",
      inputSchema: {
        from: z.union([z.literal("source"), z.object({ captureId: z.string() })]),
        stylesheets: z
          .array(z.string())
          .optional()
          .describe(
            "In cascade order (/static/site.css or https URLs); default the captured page's, else the current list",
          ),
      },
    },
    async (args) => toMcp(await storeHostFiles(ctx, args)),
  );
}
