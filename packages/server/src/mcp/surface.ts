import type { McpServer, RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { errorResult, jsonResult, type McpContent, type McpResult } from "./tools/result.ts";

export const MCP_SURFACE_MODES = ["guided", "profile", "full"] as const;
export type McpSurfaceMode = (typeof MCP_SURFACE_MODES)[number];

export const MCP_PROFILE_IDS = [
  "code-to-design",
  "three-variants",
  "local-comments",
  "design-to-code",
] as const;
export type McpProfileId = (typeof MCP_PROFILE_IDS)[number];

export type McpSurfaceSelection = {
  mode: McpSurfaceMode;
  profile?: McpProfileId | undefined;
};

export const DEFAULT_MCP_SURFACE: McpSurfaceSelection = { mode: "guided" };

const COMMON = [
  "list_components",
  "component_status",
  "list_screens",
  "list_boards",
  "get_board",
  "get_screen",
  "get_theme",
  "find_nodes",
  "screenshot",
] as const;

/**
 * Native-schema profiles selected by the client before model context is built.
 * They intentionally name operations, not tool families: the intersection with
 * the live catalogue makes optional cloud/folder capabilities disappear cleanly.
 */
export const MCP_PROFILES: Record<McpProfileId, readonly string[]> = {
  "code-to-design": [
    ...COMMON,
    "list_assets",
    "import_assets",
    "import_theme",
    "add_screen",
    "update_screen",
    "compose",
    "update_props",
    "move_node",
    "set_node_id",
    "remove_node",
    "add_snippet",
    "update_snippet",
    "batch",
    "compare_to_url",
  ],
  "three-variants": [
    ...COMMON,
    "add_board",
    "update_board",
    "add_screen",
    "update_screen",
    "compose",
    "update_props",
    "move_node",
    "set_node_id",
    "add_frame",
    "update_frame",
    "add_snippet",
    "update_snippet",
    "batch",
  ],
  "local-comments": [
    ...COMMON,
    "list_annotations",
    "get_comment_thread",
    "list_comment_threads",
    "update_comment_thread",
    "update_screen",
    "compose",
    "update_props",
    "move_node",
    "set_node_id",
    "batch",
  ],
  "design-to-code": [
    ...COMMON,
    "get_snippet",
    "emit_code",
    "emit_snippet",
    "emit_theme",
    "render_snippet",
  ],
};

export const MCP_PROFILE_RECIPES: Record<McpProfileId, string> = {
  "code-to-design":
    "Read the host source, inspect the design library and theme, rebuild in large subtrees, compare_to_url until faithful, then screenshot.",
  "three-variants":
    "Inspect the source design, create three structurally distinct screens, place one desktop frame for each on a board, then screenshot all three.",
  "local-comments":
    "Call list_annotations or list_comment_threads first, inspect every target, preserve the feedback records, make each requested design change, then screenshot.",
  "design-to-code":
    "Inspect the finished screen, call emit_code before implementation, write the route in the host app, verify it renders, and compare the implementation visually.",
};

export type SurfaceParseResult =
  | { ok: true; selection: McpSurfaceSelection }
  | { ok: false; error: string };

export function parseMcpSurfaceSelection(
  modeValue?: string | null,
  profileValue?: string | null,
): SurfaceParseResult {
  const mode = (modeValue || DEFAULT_MCP_SURFACE.mode) as McpSurfaceMode;
  if (!(MCP_SURFACE_MODES as readonly string[]).includes(mode)) {
    return {
      ok: false,
      error: `unknown MCP surface "${mode}"; expected ${MCP_SURFACE_MODES.join(", ")}`,
    };
  }
  const profile = profileValue || undefined;
  if (profile && !(MCP_PROFILE_IDS as readonly string[]).includes(profile)) {
    return {
      ok: false,
      error: `unknown MCP profile "${profile}"; expected ${MCP_PROFILE_IDS.join(", ")}`,
    };
  }
  if (mode === "profile" && !profile) {
    return {
      ok: false,
      error: `surface "profile" requires --profile (${MCP_PROFILE_IDS.join(", ")})`,
    };
  }
  if (mode === "full" && profile) {
    return { ok: false, error: 'surface "full" cannot be combined with a profile' };
  }
  return {
    ok: true,
    selection: { mode, ...(profile ? { profile: profile as McpProfileId } : {}) },
  };
}

export function parseMcpSurfaceUrl(url: string | undefined): SurfaceParseResult {
  const parsed = new URL(url ?? "/mcp", "http://velloo.local");
  return parseMcpSurfaceSelection(
    parsed.searchParams.get("surface"),
    parsed.searchParams.get("profile"),
  );
}

export function withMcpSurfaceUrl(url: string, selection: McpSurfaceSelection): string {
  const parsed = new URL(url);
  parsed.searchParams.set("surface", selection.mode);
  if (selection.profile) parsed.searchParams.set("profile", selection.profile);
  else parsed.searchParams.delete("profile");
  return parsed.toString();
}

type CallableHandler = (args: unknown, extra: unknown) => McpResult | Promise<McpResult>;
type RegisteredNative = RegisteredTool & { handler: CallableHandler };

function schemaJson(tool: RegisteredNative): Record<string, unknown> {
  if (!tool.inputSchema) return { type: "object", properties: {}, additionalProperties: false };
  try {
    return z.toJSONSchema(tool.inputSchema as z.ZodType) as Record<string, unknown>;
  } catch {
    return { type: "object", description: "Schema is not representable as JSON Schema" };
  }
}

function operationHelp(operation: string, tool: RegisteredNative): Record<string, unknown> {
  return {
    operation,
    description: tool.description ?? "",
    inputSchema: schemaJson(tool),
    annotations: tool.annotations ?? {},
  };
}

function appendSchemaHelp(result: McpResult, operation: string, tool: RegisteredNative): McpResult {
  if (result.isError !== true) return result;
  return {
    ...result,
    content: [
      ...result.content,
      {
        type: "text",
        text: JSON.stringify({ kind: "OperationSchemaHelp", ...operationHelp(operation, tool) }),
      },
    ],
  };
}

function profileNames(selection: McpSurfaceSelection, allNames: readonly string[]): string[] {
  if (!selection.profile) return [...allNames];
  const available = new Set(allNames);
  return MCP_PROFILES[selection.profile].filter((name) => available.has(name));
}

/**
 * Install a registration gate before policy/trace wrappers are added. Native
 * tools still register internally so the façade can call their real handlers,
 * but tools outside the selected public surface are disabled before listTools.
 */
export function applyMcpToolSurface(
  mcp: McpServer,
  selection: McpSurfaceSelection,
): { finish(): void; nativeTools(): ReadonlyMap<string, RegisteredTool> } {
  const original = mcp.registerTool.bind(mcp);
  const native = new Map<string, RegisteredNative>();
  let registeringNative = true;

  const patched: typeof original = (name, config, cb) => {
    const registered = original(name, config, cb) as RegisteredNative;
    if (registeringNative) {
      native.set(name, registered);
      const allowed =
        selection.mode === "full" ||
        (selection.mode === "profile" &&
          selection.profile !== undefined &&
          MCP_PROFILES[selection.profile].includes(name));
      if (!allowed) registered.disable();
    }
    return registered;
  };
  (mcp as { registerTool: typeof original }).registerTool = patched;

  const invoke = async (operation: string, args: unknown, extra: unknown): Promise<McpResult> => {
    const tool = native.get(operation);
    if (!tool) return errorResult({ kind: "UnknownOperation", operation });
    const allowed = profileNames(selection, [...native.keys()]);
    if (!allowed.includes(operation)) {
      return errorResult({
        kind: "OperationOutsideProfile",
        operation,
        profile: selection.profile,
        allowedOperations: allowed,
      });
    }
    if (tool.inputSchema) {
      const parsed = await (tool.inputSchema as z.ZodType).safeParseAsync(args);
      if (!parsed.success) {
        return errorResult({
          kind: "InvalidOperationArguments",
          operation,
          issues: parsed.error.issues,
          ...operationHelp(operation, tool),
        });
      }
      return appendSchemaHelp(await tool.handler(parsed.data, extra), operation, tool);
    }
    return appendSchemaHelp(await tool.handler(extra, undefined), operation, tool);
  };

  return {
    nativeTools: () => native,
    finish() {
      registeringNative = false;
      if (selection.mode !== "guided") return;
      const allowed = profileNames(selection, [...native.keys()]);
      const operation = z.enum(allowed as [string, ...string[]]);
      const recipe = selection.profile
        ? ` Profile recipe: ${MCP_PROFILE_RECIPES[selection.profile]}`
        : "";

      mcp.registerTool(
        "call_velloo",
        {
          description: `Call one native Velloo operation. Failed calls include the exact correction schema.${recipe}`,
          inputSchema: {
            operation,
            arguments: z
              .record(z.string(), z.unknown())
              .describe("Arguments object for the native operation"),
          },
        },
        async ({ operation: name, arguments: args }, extra) => invoke(name, args, extra),
      );

      mcp.registerTool(
        "run_velloo_plan",
        {
          description: `Run up to eight native Velloo calls sequentially, stopping on the first error by default.${recipe}`,
          inputSchema: {
            calls: z
              .array(
                z.object({
                  operation,
                  arguments: z.record(z.string(), z.unknown()),
                }),
              )
              .min(1)
              .max(8),
            stopOnError: z.boolean().default(true),
          },
        },
        async ({ calls, stopOnError }, extra) => {
          const content: McpContent[] = [];
          let failedAt: number | null = null;
          for (const [index, call] of calls.entries()) {
            const result = await invoke(call.operation, call.arguments, extra);
            content.push({
              type: "text",
              text: JSON.stringify({
                index,
                operation: call.operation,
                isError: result.isError === true,
              }),
            });
            content.push(...result.content);
            if (result.isError === true && stopOnError !== false) {
              failedAt = index;
              break;
            }
          }
          const summary =
            failedAt === null
              ? { kind: "PlanCompleted", completed: calls.length }
              : { kind: "PlanFailed", failedAt, completed: failedAt + 1 };
          return {
            ...(failedAt === null ? {} : { isError: true as const }),
            content: [{ type: "text", text: JSON.stringify(summary) }, ...content],
          };
        },
      );

      mcp.registerTool(
        "operation_schema",
        {
          description: `Return the exact schema and description for one allowed native operation.${recipe}`,
          inputSchema: { operation },
        },
        async ({ operation: name }) => {
          const tool = native.get(name);
          return tool
            ? jsonResult(operationHelp(name, tool))
            : errorResult({ kind: "UnknownOperation", operation: name });
        },
      );
    },
  };
}
