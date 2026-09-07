import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

/**
 * Per-tool behavioural hints (MCP `ToolAnnotations`). A host reads these to
 * decide what to auto-approve: a `readOnlyHint` tool can run without a prompt,
 * a `destructiveHint` one should always ask. Velloo advertises many tools, and
 * them pure reads, so leaving them undeclared meant every screenshot and every
 * `list_*` looked exactly as dangerous as `remove_screen`.
 *
 * The MCP defaults are `readOnlyHint: false`, `destructiveHint: true`,
 * `idempotentHint: false`, `openWorldHint: true`. The presets below state only
 * what differs from those defaults — an omitted hint is not a missing hint, and
 * every byte here is paid by every session.
 */
export interface ToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

/** Reads local state only. Safe to auto-approve. */
const read = { readOnlyHint: true, openWorldHint: false } as const;
/** Reads, but reaches the network to do it (fetches a page, calls the cloud). */
const readRemote = { readOnlyHint: true } as const;
/** Adds something new locally. Running it twice adds twice; it never removes. */
const create = { destructiveHint: false, openWorldHint: false } as const;
/** Sets local state to a given value. Running it twice lands the same state. */
const set = { destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
/** Removes or overwrites local state. */
const destroy = { idempotentHint: true, openWorldHint: false } as const;
/** Changes state and reaches the network. */
const remote = { destructiveHint: false } as const;
/**
 * Every tool the design-mode server registers, and how it behaves. A tool
 * missing from this table (or listed here but never registered) fails
 * `tool-policy.test.ts` — the drift guard the deleted tool-family table never
 * had, which is how it went on naming three tools that had been removed.
 */
export const TOOL_ANNOTATIONS: Record<string, ToolAnnotations> = {
  // Discovery and inspection.
  find_nodes: read,
  get_board: read,
  get_capture: read,
  get_comment_thread: read,
  get_screen: read,
  get_snippet: read,
  get_theme: read,
  inspect: read,
  list_annotations: read,
  list_assets: read,
  list_boards: read,
  list_captures: read,
  list_comment_threads: read,
  list_components: read,
  component_status: read,
  list_notes: read,
  list_screens: read,
  list_themes: read,
  score_theme_contrast: read,

  // Rendering. Local: the browser loads generated HTML, never a remote page.
  screenshot: read,
  render_snippet: read,
  compare_to_url: readRemote,

  // Code emission. `emit_code`/`emit_snippet` return IR for the agent to write;
  // `emit_theme` writes real files into the host app.
  emit_code: read,
  emit_snippet: read,
  emit_theme: { idempotentHint: true, openWorldHint: false },

  // Tree.
  compose: { openWorldHint: false },
  update_props: set,
  move_node: set,
  set_node_id: set,
  remove_node: destroy,

  // Screens and boards.
  add_screen: create,
  update_screen: set,
  remove_screen: destroy,
  add_board: create,
  update_board: set,
  remove_board: destroy,
  reorder_boards: set,
  add_frame: create,
  update_frame: set,
  remove_frame: destroy,
  update_viewport_presets: set,

  // Snippets.
  add_snippet: create,
  update_snippet: set,
  remove_snippet: destroy,
  update_snippet_instance: set,

  // Theme.
  add_theme: create,
  set_theme: set,
  update_theme: set,
  remove_theme: destroy,
  import_theme: set,

  // Markup: notes, annotations, comment threads.
  add_note: create,
  update_note: set,
  remove_note: destroy,
  add_annotation: create,
  update_annotation: set,
  remove_annotation: destroy,
  update_comment_thread: set,

  // Extensions.
  add_extension: create,
  update_extension: set,
  remove_extension: destroy,

  // Assets. `generate_asset` bills the user's account on every call.
  import_assets: set,
  upload_asset: set,
  generate_asset: remote,

  // Anything else that talks to the outside world.
  batch: { openWorldHint: false },
  start_capture_session: remote,
  send_feedback: remote,
};

/** The compact façade has its own public names; native drift checks stay exact. */
const FACADE_TOOL_ANNOTATIONS: Record<string, ToolAnnotations> = {
  // These can dispatch writes, including destructive native operations.
  call_velloo: { openWorldHint: false },
  run_velloo_plan: { openWorldHint: false },
  operation_schema: read,
};

/**
 * Apply the two invariants every registered tool must satisfy, by patching
 * `registerTool` once before any tool registers:
 *
 *   1. A raw input shape is rewrapped as `z.strictObject`, so a typo'd argument
 *      fails loudly — naming the valid keys — instead of being silently dropped.
 *   2. Annotations come from {@link TOOL_ANNOTATIONS} unless the registration
 *      supplied its own, so classification lives in one auditable table rather
 *      than scattered across 20 registration files.
 *
 * Apply before `withCallRecording`; both chain via `return original(...)`, so
 * the SDK's handle propagates up unchanged.
 */
export function applyToolPolicy(mcp: McpServer): void {
  const original = mcp.registerTool.bind(mcp);
  const patched: typeof original = (name, config, cb) => {
    const input = (config as { inputSchema?: unknown }).inputSchema;
    const isRawShape =
      input !== undefined &&
      input !== null &&
      typeof input === "object" &&
      typeof (input as { safeParse?: unknown }).safeParse !== "function";
    const annotations =
      (config as { annotations?: ToolAnnotations }).annotations ??
      TOOL_ANNOTATIONS[name] ??
      FACADE_TOOL_ANNOTATIONS[name];
    // Unavoidable cast: swapping a raw shape for its z.strictObject changes the
    // SDK's inferred config generic, which no non-generic rewrap can satisfy.
    const finalConfig = {
      ...config,
      ...(isRawShape ? { inputSchema: z.strictObject(input as z.ZodRawShape) } : {}),
      ...(annotations ? { annotations } : {}),
    } as unknown as Parameters<typeof original>[1];
    return original(name, finalConfig, cb);
  };
  (mcp as { registerTool: typeof original }).registerTool = patched;
}
