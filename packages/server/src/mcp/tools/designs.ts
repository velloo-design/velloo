import { existsSync, realpathSync } from "node:fs";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { MutationContext } from "../../mutations/index.ts";
import { listDesigns, type SessionDesigns, SWITCH_DESIGN_META, switchTarget } from "../designs.ts";
import { errorResult, jsonResult } from "./result.ts";

/**
 * `list_designs` and `switch_design`, registered only for a session whose
 * checkout has more than one design — and `switch_design` only when a stdio
 * proxy can carry the session to the other design's daemon.
 */
export function registerDesignTools(
  mcp: McpServer,
  ctx: MutationContext,
  designs: SessionDesigns,
): void {
  mcp.registerTool(
    "list_designs",
    {
      description: "List this checkout's designs; `current` marks this session's.",
      inputSchema: {},
    },
    async () => jsonResult({ designs: await listDesigns(ctx.folder.root) }),
  );

  if (!designs.switchable) return;
  mcp.registerTool(
    "switch_design",
    {
      description: "Move this session to another design, by name.",
      inputSchema: { name: z.string().min(1) },
    },
    async ({ name }) => {
      const found = await switchTarget(ctx.folder.root, name);
      if (!found.ok) return errorResult(found.error as { kind: string });
      const here = existsSync(ctx.folder.root) ? realpathSync(ctx.folder.root) : ctx.folder.root;
      const there = existsSync(found.directive.root)
        ? realpathSync(found.directive.root)
        : found.directive.root;
      if (here === there) return jsonResult({ kind: "DesignUnchanged", name });
      // The proxy in front of this session reads the directive, rebinds to the
      // other design's daemon, and replaces this result with that design's
      // instructions. Without a proxy this text is all the agent sees.
      return {
        ...jsonResult({ kind: "DesignSwitchPending", name }),
        _meta: { [SWITCH_DESIGN_META]: found.directive },
      };
    },
  );
}
