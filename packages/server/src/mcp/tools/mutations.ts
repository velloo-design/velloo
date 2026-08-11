import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  addNode,
  addVariant,
  applyClasses,
  type MutationContext,
  MutationError,
  moveNode,
  removeNode,
  updateProps,
  updateVariant,
} from "../../mutations/index.ts";

function jsonResult(value: unknown): { content: { type: "text"; text: string }[] } {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function errorResult(err: unknown): {
  isError: true;
  content: { type: "text"; text: string }[];
} {
  if (err instanceof MutationError) {
    return { isError: true, content: [{ type: "text", text: JSON.stringify(err.payload) }] };
  }
  return { isError: true, content: [{ type: "text", text: String(err) }] };
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
    async (args) => {
      try {
        const r = await addNode(ctx, args as never);
        return jsonResult(r);
      } catch (err) {
        return errorResult(err);
      }
    },
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
    async (args) => {
      try {
        return jsonResult(await updateProps(ctx, args));
      } catch (err) {
        return errorResult(err);
      }
    },
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
    async (args) => {
      try {
        return jsonResult(await removeNode(ctx, args));
      } catch (err) {
        return errorResult(err);
      }
    },
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
    async (args) => {
      try {
        return jsonResult(await moveNode(ctx, args));
      } catch (err) {
        return errorResult(err);
      }
    },
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
    async (args) => {
      try {
        return jsonResult(await addVariant(ctx, args));
      } catch (err) {
        return errorResult(err);
      }
    },
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
    async (args) => {
      try {
        return jsonResult(await updateVariant(ctx, args));
      } catch (err) {
        return errorResult(err);
      }
    },
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
    async (args) => {
      try {
        return jsonResult(await applyClasses(ctx, args));
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
