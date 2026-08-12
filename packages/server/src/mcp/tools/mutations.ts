import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Result } from "@velloo/result";
import { z } from "zod";
import {
  addNode,
  addVariant,
  applyClasses,
  type MutationContext,
  type MutationError,
  moveNode,
  removeNode,
  updateProps,
  updateVariant,
} from "../../mutations/index.ts";

type McpResult = {
  content: { type: "text"; text: string }[];
  isError?: true;
};

function jsonResult(value: unknown): McpResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function mutationErrorResult(error: MutationError): McpResult {
  return { isError: true, content: [{ type: "text", text: JSON.stringify(error) }] };
}

/** Convert a mutation Result to an MCP tool response. */
function toMcp<T>(result: Result<T, MutationError>): McpResult {
  return result.ok ? jsonResult(result.value) : mutationErrorResult(result.error);
}

const PathSchema = z
  .array(z.number().int().nonnegative())
  .describe("Integer-array path from variant root, e.g. [0, 2, 1]");

export function registerMutationTools(mcp: McpServer, ctx: MutationContext): void {
  mcp.registerTool(
    "add_node",
    {
      description: "Insert a new node into a variant tree at parentPath (optional index).",
      inputSchema: {
        pageId: z.string(),
        variantId: z.string(),
        parentPath: PathSchema,
        componentRef: z.string(),
        props: z.record(z.string(), z.unknown()).optional(),
        children: z.array(z.unknown()).optional(),
        index: z.number().int().nonnegative().optional(),
      },
    },
    async (args) => toMcp(await addNode(ctx, args as never)),
  );

  mcp.registerTool(
    "update_props",
    {
      description: "Shallow-merge a prop patch into the node at path. Use null to remove a key.",
      inputSchema: {
        pageId: z.string(),
        variantId: z.string(),
        path: PathSchema,
        propPatch: z.record(z.string(), z.unknown()),
      },
    },
    async (args) => toMcp(await updateProps(ctx, args)),
  );

  mcp.registerTool(
    "remove_node",
    {
      description: "Remove the node at path. Cannot remove the variant root.",
      inputSchema: {
        pageId: z.string(),
        variantId: z.string(),
        path: PathSchema,
      },
    },
    async (args) => toMcp(await removeNode(ctx, args)),
  );

  mcp.registerTool(
    "move_node",
    {
      description:
        "Move a node from fromPath to a new parent. toIndex is the insertion index in the destination's children.",
      inputSchema: {
        pageId: z.string(),
        variantId: z.string(),
        fromPath: PathSchema,
        toParent: PathSchema,
        toIndex: z.number().int().nonnegative().optional(),
      },
    },
    async (args) => toMcp(await moveNode(ctx, args)),
  );

  mcp.registerTool(
    "add_variant",
    {
      description:
        "Add a new variant to a page. If fromVariantId is set, the new variant clones that variant's tree.",
      inputSchema: {
        pageId: z.string(),
        fromVariantId: z.string().optional(),
        viewport: z.object({ w: z.number().int().positive(), h: z.number().int().positive() }),
        name: z.string(),
        id: z.string().optional(),
      },
    },
    async (args) => toMcp(await addVariant(ctx, args)),
  );

  mcp.registerTool(
    "update_variant",
    {
      description:
        "Update a variant's metadata (name / viewport / canvas position). Sparse: pass only the fields you want to change. Pass position: null to clear and return to auto-flow layout.",
      inputSchema: {
        pageId: z.string(),
        variantId: z.string(),
        patch: z.object({
          name: z.string().optional(),
          viewport: z
            .object({ w: z.number().int().positive(), h: z.number().int().positive() })
            .optional(),
          position: z.union([z.object({ x: z.number(), y: z.number() }), z.null()]).optional(),
        }),
      },
    },
    async (args) => toMcp(await updateVariant(ctx, args)),
  );

  mcp.registerTool(
    "apply_classes",
    {
      description: "Replace the className prop on a node with the given Tailwind class string.",
      inputSchema: {
        pageId: z.string(),
        variantId: z.string(),
        path: PathSchema,
        classes: z.string(),
      },
    },
    async (args) => toMcp(await applyClasses(ctx, args)),
  );
}
