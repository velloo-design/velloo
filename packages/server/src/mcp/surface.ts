import type { McpServer, RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { summarizeIssues } from "./argument-issues.ts";
import { errorResult, jsonResult, type McpContent, type McpResult } from "./tools/result.ts";

export const MCP_SURFACE_MODES = ["guided", "full"] as const;
export type McpSurfaceMode = (typeof MCP_SURFACE_MODES)[number];

export type McpSurfaceSelection = {
  mode: McpSurfaceMode;
};

export const DEFAULT_MCP_SURFACE: McpSurfaceSelection = { mode: "guided" };

export type SurfaceParseResult =
  | { ok: true; selection: McpSurfaceSelection }
  | { ok: false; error: string };

/**
 * Workflow profiles are gone: their allow-lists amputated operations their own
 * recipes needed (`code-to-design` forbade the `add_board` its bare-folder
 * setup order calls for), and a session's surface is immutable, so a blocked
 * agent had no way back. Legacy selections still parse rather than failing the
 * handshake — a stale MCP URL in a client config keeps working, and the old
 * `profile` mode meant "native schemas, no façade", which is what `full` is.
 */
const LEGACY_SURFACE_ALIASES: Record<string, McpSurfaceMode> = { profile: "full" };

export function parseMcpSurfaceSelection(modeValue?: string | null): SurfaceParseResult {
  const raw = modeValue || DEFAULT_MCP_SURFACE.mode;
  const mode = (LEGACY_SURFACE_ALIASES[raw] ?? raw) as McpSurfaceMode;
  if (!(MCP_SURFACE_MODES as readonly string[]).includes(mode)) {
    return {
      ok: false,
      error: `unknown MCP surface "${raw}"; expected ${MCP_SURFACE_MODES.join(", ")}`,
    };
  }
  return { ok: true, selection: { mode } };
}

export function parseMcpSurfaceUrl(url: string | undefined): SurfaceParseResult {
  const parsed = new URL(url ?? "/mcp", "http://velloo.local");
  return parseMcpSurfaceSelection(parsed.searchParams.get("surface"));
}

export function withMcpSurfaceUrl(url: string, selection: McpSurfaceSelection): string {
  const parsed = new URL(url);
  parsed.searchParams.set("surface", selection.mode);
  parsed.searchParams.delete("profile");
  return parsed.toString();
}

type CallableHandler = (args: unknown, extra: unknown) => McpResult | Promise<McpResult>;
type RegisteredNative = RegisteredTool & { handler: CallableHandler };

function schemaJson(tool: RegisteredNative): Record<string, unknown> {
  if (!tool.inputSchema) return { type: "object", properties: {}, additionalProperties: false };
  try {
    // `io: "input"` because this schema tells the agent what to *send*. Without
    // it every jsonTolerant() argument (a string-or-object union carrying a
    // transform) throws "Transforms cannot be represented in JSON Schema", and
    // the tree-taking operations — add_screen among them — answer
    // operation_schema and their own correction hint with nothing.
    return z.toJSONSchema(tool.inputSchema as z.ZodType, {
      io: "input",
    }) as Record<string, unknown>;
  } catch {
    return { type: "object", description: "Schema is not representable as JSON Schema" };
  }
}

/** Top-level argument names an operation accepts, for a rejection's hint. */
function acceptedKeys(tool: RegisteredNative): string[] {
  const schema = schemaJson(tool);
  const properties = schema.properties;
  return properties && typeof properties === "object" ? Object.keys(properties) : [];
}

function operationHelp(operation: string, tool: RegisteredNative): Record<string, unknown> {
  return {
    operation,
    description: tool.description ?? "",
    inputSchema: schemaJson(tool),
    annotations: tool.annotations ?? {},
  };
}

/** The failing call's own error text, for the plan summary. */
function errorTextOf(result: McpResult): string {
  return result.content
    .filter((part): part is McpContent & { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join(" ")
    .slice(0, 400);
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
      if (selection.mode !== "full") registered.disable();
    }
    return registered;
  };
  (mcp as { registerTool: typeof original }).registerTool = patched;

  const invoke = async (operation: string, args: unknown, extra: unknown): Promise<McpResult> => {
    const tool = native.get(operation);
    if (!tool) return errorResult({ kind: "UnknownOperation", operation });
    if (tool.inputSchema) {
      const parsed = await (tool.inputSchema as z.ZodType).safeParseAsync(args);
      if (!parsed.success) {
        const problem = summarizeIssues(parsed.error.issues, acceptedKeys(tool));
        return errorResult({
          kind: "InvalidOperationArguments",
          operation,
          // One readable sentence first; the raw issues stay for exactness.
          ...(problem ? { problem } : {}),
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
      const operation = z.enum([...native.keys()] as [string, ...string[]]);

      mcp.registerTool(
        "call_velloo",
        {
          description:
            "Call one native Velloo operation. Failed calls include the exact correction schema.",
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
          description:
            "Run up to eight native Velloo calls sequentially, stopping on the first error by default.",
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
          let failure: { operation: string; error: string } | undefined;
          for (const [index, call] of calls.entries()) {
            // A switch retargets every call after it, and the plan's results
            // would silently describe two designs — it has to stand alone.
            const result =
              call.operation === "switch_design"
                ? errorResult({
                    kind: "SwitchDesignInPlan",
                    message: "Call switch_design on its own, then plan against the new design.",
                  })
                : await invoke(call.operation, call.arguments, extra);
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
              failure = { operation: call.operation, error: errorTextOf(result) };
              break;
            }
          }
          const summary =
            failedAt === null
              ? { kind: "PlanCompleted", completed: calls.length }
              : {
                  kind: "PlanFailed",
                  failedAt,
                  // The failed call is not one of them: `completed` is what landed.
                  completed: failedAt,
                  operation: failure?.operation,
                  error: failure?.error,
                  remaining: calls.length - failedAt - 1,
                };
          return {
            ...(failedAt === null ? {} : { isError: true as const }),
            content: [{ type: "text", text: JSON.stringify(summary) }, ...content],
          };
        },
      );

      mcp.registerTool(
        "operation_schema",
        {
          description: "Return the exact schema and description for one native operation.",
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
