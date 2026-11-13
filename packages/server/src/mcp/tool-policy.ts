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
  list_designs: read,
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
  // Mounts one component in a local headless browser; writes nothing.
  preview_status: read,
  // Mounts the app's components in one local headless render; writes nothing.
  check_components: read,
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

  // Which design the session works on. Local: the proxy only rebinds its connection.
  switch_design: set,

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
  connect_frames: set,
  update_viewport_presets: set,

  // Snippets.
  add_snippet: create,
  update_snippet: set,
  remove_snippet: destroy,
  update_snippet_instance: set,

  // Theme.
  add_theme: create,
  set_theme: set,
  set_design_language: set,
  update_theme: set,
  remove_theme: destroy,
  import_theme: set,
  store_host_files: destroy,

  // Markup: notes, annotations, comment threads.
  add_note: create,
  update_note: set,
  remove_note: destroy,
  add_annotation: create,
  update_annotation: set,
  remove_annotation: destroy,
  update_comment_thread: set,

  // The app components' preview entry: writes code the canvas then runs locally.
  set_preview_entry: set,

  // Extensions.
  add_extension: create,
  update_extension: set,
  remove_extension: destroy,

  // Assets. `generate_asset` bills the user's account on every call.
  import_assets: set,
  upload_asset: set,
  generate_asset: remote,

  // The sketchbook: a design's look explored in images before it is built.
  get_sketchbook: read,
  update_sketchbook: set,
  // Bills the user's account for every image.
  generate_sketchbook: remote,
  // A Look: its theme's imagery, rules and origin (a direction makes its theme too).
  update_look: set,

  // Anything else that talks to the outside world.
  batch: { openWorldHint: false },
  start_capture_session: remote,
  send_feedback: remote,
};

/** The compact façade has its own public names; native drift checks stay exact. */
const FACADE_TOOL_ANNOTATIONS: Record<string, ToolAnnotations> = {
  // Every operation `readOnlyHint` marks above, and nothing else.
  read_velloo: readRemote,
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

type RawRequestHandler = (request: unknown, extra: unknown) => Promise<unknown>;

/** A tool definition as `tools/list` sends it, minus what tells a model nothing. */
function leanTool(tool: Record<string, unknown>): Record<string, unknown> {
  const { execution, inputSchema, outputSchema, ...rest } = tool;
  // `taskSupport: "forbidden"` is the spec's default when `execution` is
  // absent; a client acts only on "optional" or "required".
  const defaultExecution =
    (execution as { taskSupport?: string } | undefined)?.taskSupport === "forbidden";
  return {
    ...rest,
    inputSchema: withoutDialect(inputSchema),
    ...(outputSchema !== undefined ? { outputSchema: withoutDialect(outputSchema) } : {}),
    ...(execution !== undefined && !defaultExecution ? { execution } : {}),
  };
}

function withoutDialect(schema: unknown): unknown {
  if (typeof schema !== "object" || schema === null) return schema;
  const { $schema: _dialect, ...body } = schema as Record<string, unknown>;
  return body;
}

/**
 * Strip from `tools/list` what the SDK puts on every tool and no model reads:
 * the JSON Schema dialect URL on each input and output schema (MCP assumes one
 * when it is absent) and the default `execution`. Some 1,750 tokens of every
 * full-surface session. Call once every tool is registered — the SDK installs
 * its listing handler on the first registration — so this wraps the one place
 * a listing is made, `tools/list_changed` re-lists included.
 */
export function leanToolListing(mcp: McpServer): void {
  const handlers = (mcp.server as unknown as { _requestHandlers?: Map<string, RawRequestHandler> })
    ._requestHandlers;
  const original = handlers?.get("tools/list");
  if (!handlers || !original) throw new Error("leanToolListing: no tools/list handler to wrap");
  handlers.set("tools/list", async (request, extra) => {
    const result = (await original(request, extra)) as { tools?: Record<string, unknown>[] };
    return { ...result, tools: (result.tools ?? []).map(leanTool) };
  });
}
