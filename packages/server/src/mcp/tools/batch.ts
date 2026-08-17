import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Result } from "@velloo/result";
import { z } from "zod";
import {
  addBoard,
  addFrame,
  addGroup,
  addNode,
  addNote,
  addScreen,
  addSnippet,
  instantiateSnippet,
  type MutationContext,
  type MutationError,
  moveNode,
  removeNode,
  setNodeId,
  updateFrame,
  updateProps,
} from "../../mutations/index.ts";

/**
 * Sequential multi-call envelope for big builds (a board's worth of
 * screens + frames in one round-trip). NOT transactional: each call
 * persists as it lands and the batch stops at the first error,
 * reporting how far it got. For atomic multi-node edits within one
 * screen, prefer update_props with `patches`.
 */
type BatchFn = (ctx: MutationContext, args: never) => Promise<Result<unknown, MutationError>>;

const BATCH_TOOLS: Record<string, BatchFn> = {
  add_screen: addScreen as BatchFn,
  add_board: addBoard as BatchFn,
  add_frame: addFrame as BatchFn,
  add_group: addGroup as BatchFn,
  add_node: addNode as BatchFn,
  update_props: updateProps as BatchFn,
  remove_node: removeNode as BatchFn,
  move_node: moveNode as BatchFn,
  set_node_id: setNodeId as BatchFn,
  add_snippet: addSnippet as BatchFn,
  instantiate_snippet: instantiateSnippet as BatchFn,
  update_frame: updateFrame as BatchFn,
  add_note: addNote as BatchFn,
};

export function registerBatchTool(mcp: McpServer, ctx: MutationContext): void {
  mcp.registerTool(
    "batch",
    {
      description: `Run a sequence of mutation calls in one round-trip. Sequential, stops at the first error (NOT transactional — earlier calls stay applied; the result reports completed count). Supported tools: ${Object.keys(BATCH_TOOLS).join(", ")}. Each entry is { tool, args } with the same args the standalone tool takes.`,
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
      },
    },
    async ({ calls }) => {
      const results: Array<{ tool: string; ok: boolean; value?: unknown; error?: unknown }> = [];
      for (const call of calls) {
        const fn = BATCH_TOOLS[call.tool];
        if (!fn) {
          results.push({
            tool: call.tool,
            ok: false,
            error: { kind: "BadRequest", message: `batch: unsupported tool "${call.tool}"` },
          });
          break;
        }
        try {
          const r = await fn(ctx, call.args as never);
          if (r.ok) {
            results.push({ tool: call.tool, ok: true, value: r.value });
          } else {
            results.push({ tool: call.tool, ok: false, error: r.error });
            break;
          }
        } catch (err) {
          results.push({
            tool: call.tool,
            ok: false,
            error: {
              kind: "BadRequest",
              message: err instanceof Error ? err.message : String(err),
            },
          });
          break;
        }
      }
      const failed = results.some((r) => !r.ok);
      const payload = {
        completed: results.filter((r) => r.ok).length,
        total: calls.length,
        results,
      };
      return {
        ...(failed ? { isError: true as const } : {}),
        content: [{ type: "text" as const, text: JSON.stringify(payload) }],
      };
    },
  );
}
