import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

/**
 * Rewrap every tool's raw input shape as `z.strictObject` so a typo'd argument
 * fails loudly — naming the valid keys — instead of being silently dropped.
 *
 * Apply before any tool registers, and before `withCallRecording`; both chain
 * via `return original(...)`, so the SDK's handle propagates up unchanged.
 */
export function enforceStrictToolInputs(mcp: McpServer): void {
  const original = mcp.registerTool.bind(mcp);
  const patched: typeof original = (name, config, cb) => {
    const input = (config as { inputSchema?: unknown }).inputSchema;
    const isRawShape =
      input !== undefined &&
      input !== null &&
      typeof input === "object" &&
      typeof (input as { safeParse?: unknown }).safeParse !== "function";
    // Unavoidable cast: swapping a raw shape for its z.strictObject changes the
    // SDK's inferred config generic, which no non-generic rewrap can satisfy.
    const finalConfig = isRawShape
      ? ({
          ...config,
          inputSchema: z.strictObject(input as z.ZodRawShape),
        } as unknown as Parameters<typeof original>[1])
      : config;
    return original(name, finalConfig, cb);
  };
  (mcp as { registerTool: typeof original }).registerTool = patched;
}
