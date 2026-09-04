import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { collectActivity, emitGroupedActivity } from "../../activity.ts";
import { BATCH_TOOLS, type BatchCall, runBatch } from "../../mutations/batch.ts";
import type { MutationContext } from "../../mutations/index.ts";

/**
 * The batchable tool set, in the schema rather than in the description.
 *
 * `args` stays loose on purpose. A discriminated union over the real bodies was
 * built and measured: it takes `batch` from ~300 to ~4,100 boot tokens — 19% of
 * the whole surface — to restate eighteen schemas that `tools/list` already
 * carries, because MCP gives tools no way to share definitions. It bought no
 * correctness either: `runBatch` validates every entry against the same
 * `@velloo/protocol` body the standalone tool uses, and says which tool and
 * which field, which is more than a union's `anyOf` failure would. So the enum
 * carries the one thing prose was carrying badly — the set of legal `tool`
 * values — and the argument shapes stay where they are already advertised.
 */
const batchableTools = Object.keys(BATCH_TOOLS) as [string, ...string[]];

export function registerBatchTool(mcp: McpServer, ctx: MutationContext): void {
  mcp.registerTool(
    "batch",
    {
      description:
        "Run a sequence of mutation calls in one round-trip; each entry is `{ tool, args }` with that tool's own arguments. Atomic by default — the first error rolls every touched resource back to its pre-batch state and reports `rolledBack: true` with the failing call. `atomic: false` runs until error and keeps completed work.",
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
      inputSchema: {
        calls: z
          .array(
            z.strictObject({
              tool: z.enum(batchableTools),
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
      const { value: result, ops } = await collectActivity(() =>
        runBatch(ctx, calls as BatchCall[], { atomic }),
      );
      if (!result.rolledBack) emitGroupedActivity(ctx, "batch", ops);
      const failed = result.results.some((r) => !r.ok);
      return {
        ...(failed ? { isError: true as const } : {}),
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
      };
    },
  );
}
