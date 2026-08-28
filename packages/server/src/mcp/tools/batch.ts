import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { collectActivity, emitGroupedActivity } from "../../activity.ts";
import { BATCH_TOOLS, runBatch } from "../../mutations/batch.ts";
import type { MutationContext } from "../../mutations/index.ts";

export function registerBatchTool(mcp: McpServer, ctx: MutationContext): void {
  mcp.registerTool(
    "batch",
    {
      description: `Run a sequence of mutation calls in one round-trip. Atomic by default: on the first error every touched resource rolls back to its pre-batch state, created screens/boards/snippets are deleted, and undo history is unwound — the result reports rolledBack: true with the failing call. Pass atomic: false for run-until-error without rollback. Supported tools: ${Object.keys(BATCH_TOOLS).join(", ")}. Each entry is { tool, args } with the standalone tool's args.`,
      inputSchema: {
        calls: z
          .array(
            z.object({
              tool: z.string(),
              args: z.record(z.string(), z.unknown()),
            }),
          )
          .min(1)
          .max(100),
        atomic: z.boolean().optional().describe("Default true"),
      },
    },
    async ({ calls, atomic }) => {
      // Inner calls collect their activity; the burst publishes as ONE grouped
      // event — and nothing at all when an atomic batch rolled back (the
      // canvas must not flash changes that no longer exist). See activity.ts.
      const { value: result, ops } = await collectActivity(() => runBatch(ctx, calls, { atomic }));
      if (!result.rolledBack) emitGroupedActivity(ctx, "batch", ops);
      const failed = result.results.some((r) => !r.ok);
      return {
        ...(failed ? { isError: true as const } : {}),
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
      };
    },
  );
}
