import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Result } from "@velloo/result";
import { isComponentNode, type Node, NodeSchema, SnippetParamSchema } from "@velloo/schema";
import { z } from "zod";
import {
  addBoard,
  addFrame,
  addGroup,
  addNode,
  addScreen,
  addSnippet,
  instantiateSnippet,
  type MutationContext,
  type MutationError,
  moveNode,
  removeBoard,
  removeFrame,
  removeGroup,
  removeNode,
  removeScreen,
  removeSnippet,
  setNodeId,
  updateBoard,
  updateFrame,
  updateFrames,
  updateGroup,
  updateProps,
  updatePropsBulk,
  updateScreen,
  updateSnippet,
  updateSnippetArgs,
} from "../../mutations/index.ts";
import { propWarnings, propWarningsForTree } from "../../mutations/prop-warnings.ts";
import { pathAt } from "../../path.ts";

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

/**
 * Like toMcp, but on success attaches advisory `propWarnings` (typo'd
 * prop names, enum mismatches) so the agent can self-correct without a
 * follow-up inspect round-trip. Warnings never fail the mutation.
 */
async function toMcpWithWarnings<T>(
  result: Result<T, MutationError>,
  warn: (value: T) => Promise<string[]>,
): Promise<McpResult> {
  if (!result.ok) return mutationErrorResult(result.error);
  const propWarnings = await warn(result.value).catch(() => [] as string[]);
  return jsonResult(propWarnings.length > 0 ? { ...result.value, propWarnings } : result.value);
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
    async (args) =>
      toMcpWithWarnings(await addNode(ctx, args as never), async () => {
        const screen = ctx.folder.screens.get(args.screenId as string);
        if (!screen) return [];
        const inserted = {
          $ref: args.componentRef,
          ...(args.props ? { props: args.props } : {}),
          ...(args.children ? { children: args.children } : {}),
        } as Node;
        return propWarningsForTree(ctx, screen, inserted);
      }),
  );

  mcp.registerTool(
    "update_props",
    {
      description:
        "Shallow-merge a prop patch into the node at path. Use null to remove a key. className is a prop like any other — set it here to restyle a node. To patch many nodes in one atomic write (single history entry + broadcast), pass `patches: [{ path, propPatch }]` instead of path/propPatch.",
      inputSchema: {
        screenId: z.string(),
        path: PathSchema.optional(),
        propPatch: z.record(z.string(), z.unknown()).optional(),
        patches: z
          .array(z.object({ path: PathSchema, propPatch: z.record(z.string(), z.unknown()) }))
          .min(1)
          .optional()
          .describe("Bulk mode — mutually exclusive with path/propPatch"),
      },
    },
    async (args) => {
      if (args.patches) {
        if (args.path !== undefined || args.propPatch !== undefined) {
          return mutationErrorResult({
            kind: "BadRequest",
            message: "update_props: pass either path+propPatch or patches, not both.",
          });
        }
        const bulkArgs = { screenId: args.screenId, patches: args.patches };
        return toMcpWithWarnings(await updatePropsBulk(ctx, bulkArgs), async () => {
          const screen = ctx.folder.screens.get(args.screenId);
          if (!screen) return [];
          const all: string[] = [];
          for (const patch of bulkArgs.patches) {
            if (!Array.isArray(patch.path)) continue;
            const node = pathAt(screen.tree, patch.path);
            if (node && isComponentNode(node)) {
              all.push(...(await propWarnings(ctx, screen, node.$ref, patch.propPatch)));
            }
          }
          return all;
        });
      }
      if (args.path === undefined || args.propPatch === undefined) {
        return mutationErrorResult({
          kind: "BadRequest",
          message: "update_props: path and propPatch are required (or pass patches).",
        });
      }
      const single = { screenId: args.screenId, path: args.path, propPatch: args.propPatch };
      return toMcpWithWarnings(await updateProps(ctx, single), async (value) => {
        const screen = ctx.folder.screens.get(args.screenId);
        if (!screen) return [];
        const node = pathAt(screen.tree, value.path);
        if (!node || !isComponentNode(node)) return [];
        return propWarnings(ctx, screen, node.$ref, single.propPatch);
      });
    },
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

  // apply_classes / apply_classes_bulk / update_props_bulk were folded
  // into update_props (className is just a prop; `patches` covers bulk).
  // The server mutations remain for the canvas HTTP surface.

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
    async (args) =>
      toMcpWithWarnings(await addScreen(ctx, args), async () => {
        const created = args.id ?? "";
        const screen =
          ctx.folder.screens.get(created) ??
          [...ctx.folder.screens.values()].find((s) => s.name === args.name);
        if (!screen) return [];
        return propWarningsForTree(ctx, screen, screen.tree);
      }),
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

  // ── Board lifecycle ────────────────────────────────────────────────────
  mcp.registerTool(
    "add_board",
    {
      description:
        "Create a new empty board. A board is one infinite canvas with its own frames + groups; a design folder can have many.",
      inputSchema: { name: z.string(), id: z.string().optional() },
    },
    async (args) => toMcp(await addBoard(ctx, args)),
  );

  mcp.registerTool(
    "update_board",
    {
      description: "Update a board's metadata (name only today).",
      inputSchema: {
        boardId: z.string(),
        patch: z.object({ name: z.string().optional() }),
      },
    },
    async (args) => toMcp(await updateBoard(ctx, args)),
  );

  mcp.registerTool(
    "remove_board",
    {
      description: "Delete a board. Refuses when it's the last board in the folder.",
      inputSchema: { boardId: z.string() },
    },
    async (args) => toMcp(await removeBoard(ctx, args)),
  );

  // ── Frame / group lifecycle ────────────────────────────────────────────
  mcp.registerTool(
    "add_frame",
    {
      description:
        "Place a screen on a specific board at a chosen size + position. x/y default to a free spot on that board.",
      inputSchema: {
        boardId: z.string(),
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
        "Update a frame's position, size, label, or group on a given board. Pass `label: null` or `group: null` to clear.",
      inputSchema: {
        boardId: z.string(),
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
        "Atomic bulk frame update on one board — single persist + broadcast + history entry.",
      inputSchema: {
        boardId: z.string(),
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
      description: "Remove a frame placement from a board. The underlying screen is left intact.",
      inputSchema: { boardId: z.string(), frameId: z.string() },
    },
    async (args) => toMcp(await removeFrame(ctx, args)),
  );

  mcp.registerTool(
    "add_group",
    {
      description:
        "Create a group on a board — a visual tag for related frames (e.g. 'marketing flow').",
      inputSchema: {
        boardId: z.string(),
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
      description: "Update a group's name or color on a board. Pass `color: null` to clear.",
      inputSchema: {
        boardId: z.string(),
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
        "Remove a group from a board. Frames in the group are not deleted — they're un-grouped.",
      inputSchema: { boardId: z.string(), groupId: z.string() },
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
