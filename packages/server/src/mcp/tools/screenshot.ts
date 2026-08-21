import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CanvasBundler } from "../../live/canvas-bundler.ts";
import type { LiveBundler } from "../../live/component-bundler.ts";
import type { MutationContext } from "../../mutations/index.ts";
import type { TailwindJit } from "../../styles/tailwind-jit.ts";
import { registerCompareToUrlTool } from "./compare-to-url.ts";
import { registerRenderSnippetTool } from "./render-snippet.ts";
import { registerScreenshotCaptureTool } from "./screenshot-capture.ts";

/**
 * Registers the three render/capture MCP tools — `screenshot`,
 * `compare_to_url`, `render_snippet`. They share the helpers in
 * screenshot-helpers.ts but otherwise own their own caches and logic, one file
 * each.
 */
export function registerScreenshotTool(
  mcp: McpServer,
  ctx: MutationContext,
  jit: TailwindJit,
  bundler: LiveBundler,
  canvasBundler: CanvasBundler,
  assetOrigin?: string,
): void {
  registerScreenshotCaptureTool(mcp, ctx, jit, bundler, canvasBundler, assetOrigin);
  registerCompareToUrlTool(mcp, ctx, jit, bundler, canvasBundler, assetOrigin);
  registerRenderSnippetTool(mcp, ctx, jit, bundler, canvasBundler, assetOrigin);
}
