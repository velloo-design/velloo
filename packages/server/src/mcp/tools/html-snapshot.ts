import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { type SnapshotDeps, snapshotFromApp } from "../../html-snapshot.ts";
import type { MutationContext } from "../../mutations/index.ts";
import { errorResult } from "./result.ts";
import { browserErrorMessage } from "./screenshot-helpers.ts";

export function registerHtmlSnapshotTool(
  mcp: McpServer,
  ctx: MutationContext,
  deps: SnapshotDeps,
): void {
  mcp.registerTool(
    "snapshot_from_app",
    {
      description:
        "HTML designs: replace each HtmlFragment on a screen with editable Html nodes captured from the running app (through the canvas's signed-in session), or re-capture earlier snapshots. The design then shows the page without the app. Refuses, changing nothing, when the app redirects (a sign-in page) or fails — ask the user to sign in once in a Preview. Replaces any edits inside a snapshot.",
      inputSchema: { screenId: z.string() },
    },
    async ({ screenId }) => {
      try {
        const result = await snapshotFromApp(ctx, deps, screenId);
        if (!result.ok) return errorResult(result.error);
        return { content: [{ type: "text", text: JSON.stringify(result.value) }] };
      } catch (error) {
        return errorResult(
          browserErrorMessage(error) ??
            `snapshot_from_app failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );
}
