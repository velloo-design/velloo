import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Result } from "@velloo/result";
import { NodeSchema, SnippetParamSchema } from "@velloo/schema";
import { z } from "zod";
import {
  addFrame,
  addGroup,
  addNode,
  addScreen,
  addSnippet,
  applyClasses,
  applyClassesBulk,
  instantiateSnippet,
  type MutationContext,
  type MutationError,
  moveNode,
  removeFrame,
  removeGroup,
  removeNode,
  removeScreen,
  removeSnippet,
  setNodeId,
  updateFrame,
  updateFrames,
  updateGroup,
  updateProps,
  updatePropsBulk,
  updateScreen,
  updateSnippet,
  updateSnippetArgs,
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

function toMcp<T>(result: Result<T, MutationError>): McpResult {
  return result.ok ? jsonResult(result.value) : mutationErrorResult(result.error);
}

const IdLocator = z
  .string()
  .regex(/^@[a-zA-Z][a-zA-Z0-9_-]*$/)
  .describe(`@id reference, e.g. "@hero-cta"`);
const PathSchema = z
  .union([z.array(z.number().int().nonnegative()), IdLocator])
  .describe('Path from screen tree root ([0, 2, 1]) or "@id" reference');
const NodeIdInputSchema = z
  .string()
  .regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/)
  .describe("Stable id for the node (letters/digits/_/-, leading letter)");
const ViewportSchema = z.object({
  w: z.number().int().positive(),
  h: z.number().int().positive(),
});

export function registerMutationTools(mcp: McpServer, ctx: MutationContext): void {
  // ── Tree mutations ─────────────────────────────────────────────────────
  mcp.registerTool(
    "add_node",
    {
      description:
        'Insert a new node into a screen tree under parentPath. parentPath accepts a path array OR an "@id" reference. Pass `id` for a stable anchor. children may carry full subtrees so a feature card lands in one call.',
      inputSchema: {
        screenId: z.string(),
        parentPath: PathSchema,
        componentRef: z.string(),
        id: NodeIdInputSchema.optional(),
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
        screenId: z.string(),
        path: PathSchema,
        propPatch: z.record(z.string(), z.unknown()),
      },
    },
    async (args) => toMcp(await updateProps(ctx, args)),
  );

  mcp.registerTool(
    "remove_node",
    {
      description: "Remove the node at path. Cannot remove the screen root.",
      inputSchema: {
        screenId: z.string(),
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
        screenId: z.string(),
        fromPath: PathSchema,
        toParent: PathSchema,
        toIndex: z.number().int().nonnegative().optional(),
      },
    },
    async (args) => toMcp(await moveNode(ctx, args)),
  );

  mcp.registerTool(
    "apply_classes",
    {
      description: "Replace the className prop on a node with the given Tailwind class string.",
      inputSchema: {
        screenId: z.string(),
        path: PathSchema,
        classes: z.string(),
      },
    },
    async (args) => toMcp(await applyClasses(ctx, args)),
  );

  mcp.registerTool(
    "apply_classes_bulk",
    {
      description:
        "Atomic bulk apply_classes — restyle many nodes in one call. Single persist + broadcast + history entry.",
      inputSchema: {
        screenId: z.string(),
        patches: z.array(z.object({ path: PathSchema, classes: z.string() })).min(1),
      },
    },
    async (args) => toMcp(await applyClassesBulk(ctx, args)),
  );

  mcp.registerTool(
    "update_props_bulk",
    {
      description: "Atomic bulk update_props — patch props on many nodes in one call.",
      inputSchema: {
        screenId: z.string(),
        patches: z
          .array(
            z.object({
              path: PathSchema,
              propPatch: z.record(z.string(), z.unknown()),
            }),
          )
          .min(1),
      },
    },
    async (args) => toMcp(await updatePropsBulk(ctx, args)),
  );

  mcp.registerTool(
    "set_node_id",
    {
      description:
        'Set or clear the `$id` anchor on a node. Once set, the node is addressable as "@<id>" in any path-accepting tool. Pass `id: null` to clear. Per-screen uniqueness is enforced.',
      inputSchema: {
        screenId: z.string(),
        path: PathSchema,
        id: NodeIdInputSchema.nullable(),
      },
    },
    async (args) => toMcp(await setNodeId(ctx, args)),
  );

  // ── Screen lifecycle ───────────────────────────────────────────────────
  mcp.registerTool(
    "add_screen",
    {
      description:
        "Create a new screen. Does not place it on the board — call add_frame separately to surface it on the canvas. Pass `fromScreenId` to clone an existing screen's tree, or `tree` to supply one.",
      inputSchema: {
        name: z.string(),
        id: z.string().optional(),
        fromScreenId: z.string().optional(),
        tree: NodeSchema.optional(),
      },
    },
    async (args) => toMcp(await addScreen(ctx, args)),
  );

  mcp.registerTool(
    "update_screen",
    {
      description:
        "Update screen metadata. Sparse patch — only `name` is patchable today. Screen id stays stable.",
      inputSchema: {
        screenId: z.string(),
        patch: z.object({ name: z.string().optional() }),
      },
    },
    async (args) => toMcp(await updateScreen(ctx, args)),
  );

  mcp.registerTool(
    "remove_screen",
    {
      description:
        "Delete a screen. Refuses if it's the last screen. If any frames reference the screen, they're returned in `removedFrameIds` (cascaded removal).",
      inputSchema: { screenId: z.string() },
    },
    async (args) => toMcp(await removeScreen(ctx, args)),
  );

  // ── Frame / board lifecycle ────────────────────────────────────────────
  mcp.registerTool(
    "add_frame",
    {
      description:
        "Place a screen on the board at a chosen size + position. x/y default to a free spot on the board.",
      inputSchema: {
        screenId: z.string(),
        x: z.number().optional(),
        y: z.number().optional(),
        w: z.number().int().positive(),
        h: z.number().int().positive(),
        label: z.string().optional(),
        group: z.string().optional(),
        id: z.string().optional(),
      },
    },
    async (args) => toMcp(await addFrame(ctx, args)),
  );

  mcp.registerTool(
    "update_frame",
    {
      description:
        "Update a frame's position, size, label, or group. Pass `label: null` or `group: null` to clear.",
      inputSchema: {
        frameId: z.string(),
        patch: z.object({
          x: z.number().optional(),
          y: z.number().optional(),
          w: z.number().int().positive().optional(),
          h: z.number().int().positive().optional(),
          label: z.string().nullable().optional(),
          group: z.string().nullable().optional(),
        }),
      },
    },
    async (args) => toMcp(await updateFrame(ctx, args)),
  );

  mcp.registerTool(
    "update_frames",
    {
      description:
        "Atomic bulk frame update — single persist + broadcast + history entry. Use when dragging multiple frames together.",
      inputSchema: {
        patches: z
          .array(
            z.object({
              frameId: z.string(),
              patch: z.object({
                x: z.number().optional(),
                y: z.number().optional(),
                w: z.number().int().positive().optional(),
                h: z.number().int().positive().optional(),
                label: z.string().nullable().optional(),
                group: z.string().nullable().optional(),
              }),
            }),
          )
          .min(1),
      },
    },
    async (args) => toMcp(await updateFrames(ctx, args)),
  );

  mcp.registerTool(
    "remove_frame",
    {
      description: "Remove a frame placement. The underlying screen is left intact.",
      inputSchema: { frameId: z.string() },
    },
    async (args) => toMcp(await removeFrame(ctx, args)),
  );

  mcp.registerTool(
    "add_group",
    {
      description: "Create a board group — a visual tag for related frames (e.g. 'marketing flow').",
      inputSchema: {
        name: z.string(),
        color: z.string().optional(),
        id: z.string().optional(),
      },
    },
    async (args) => toMcp(await addGroup(ctx, args)),
  );

  mcp.registerTool(
    "update_group",
    {
      description: "Update a group's name or color. Pass `color: null` to clear.",
      inputSchema: {
        groupId: z.string(),
        patch: z.object({
          name: z.string().optional(),
          color: z.string().nullable().optional(),
        }),
      },
    },
    async (args) => toMcp(await updateGroup(ctx, args)),
  );

  mcp.registerTool(
    "remove_group",
    {
      description:
        "Remove a group. Frames in the group are not deleted — they're un-grouped. Returns the affected frame ids.",
      inputSchema: { groupId: z.string() },
    },
    async (args) => toMcp(await removeGroup(ctx, args)),
  );

  // ── Snippets ────────────────────────────────────────────────────────────
  mcp.registerTool(
    "add_snippet",
    {
      description:
        'Create a reusable subtree. `params` declares typed inputs; placeholders inside the body are `{ "$param": "name" }` nodes that get substituted at render time.',
      inputSchema: {
        name: z.string(),
        id: z.string().optional(),
        params: z.array(SnippetParamSchema).default([]),
        tree: NodeSchema,
      },
    },
    async (args) => toMcp(await addSnippet(ctx, args)),
  );

  mcp.registerTool(
    "update_snippet",
    {
      description:
        "Update a snippet's metadata or body. Sparse patch — pass only the fields to change. Every screen using the snippet is re-broadcast.",
      inputSchema: {
        snippetId: z.string(),
        patch: z.object({
          name: z.string().optional(),
          params: z.array(SnippetParamSchema).optional(),
          tree: NodeSchema.optional(),
        }),
      },
    },
    async (args) => toMcp(await updateSnippet(ctx, args)),
  );

  mcp.registerTool(
    "remove_snippet",
    {
      description:
        "Delete a snippet. Refuses with SnippetInUse if any screen instantiates it; the error payload lists the referencing screenIds.",
      inputSchema: { snippetId: z.string() },
    },
    async (args) => toMcp(await removeSnippet(ctx, args)),
  );

  mcp.registerTool(
    "instantiate_snippet",
    {
      description:
        "Add a `$snippet` instance to a screen tree under parentPath. Pass `id` for a stable anchor; `extraClassName` to layer one-off Tailwind classes onto the snippet body's root.",
      inputSchema: {
        screenId: z.string(),
        parentPath: PathSchema,
        snippetId: z.string(),
        id: NodeIdInputSchema.optional(),
        args: z.record(z.string(), z.unknown()).optional(),
        extraClassName: z.string().optional(),
        index: z.number().int().nonnegative().optional(),
      },
    },
    async (args) => toMcp(await instantiateSnippet(ctx, args)),
  );

  mcp.registerTool(
    "update_snippet_args",
    {
      description:
        "Patch the `args` of a snippet instance without touching the snippet body. `null` in argPatch removes a key. Pass `extraClassName` to replace the instance's per-instance className override; `null` clears it.",
      inputSchema: {
        screenId: z.string(),
        path: PathSchema,
        argPatch: z.record(z.string(), z.unknown()).default({}),
        extraClassName: z.string().nullable().optional(),
      },
    },
    async (args) => toMcp(await updateSnippetArgs(ctx, args)),
  );

  // Suppress unused warning for ViewportSchema imported but currently unused.
  void ViewportSchema;
}
