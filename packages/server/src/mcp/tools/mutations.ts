import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Result } from "@velloo/result";
import {
  isComponentNode,
  MAX_BOARD_NAME_LENGTH,
  type Node,
  NodeSchema,
  resolveSnippetArgs,
  SnippetParamSchema,
} from "@velloo/schema";
import { z } from "zod";
import { badRequest } from "../../mutations/errors.ts";
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
  overrideSnippetProps,
  removeBoard,
  removeFrame,
  removeGroup,
  removeNode,
  removeScreen,
  removeSnippet,
  reorderBoards,
  setNodeId,
  setScreenTree,
  setStyle,
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
import {
  dynamicIconWarningsForTree,
  propWarnings,
  propWarningsForTree,
} from "../../mutations/prop-warnings.ts";
import { findSnippetInstances } from "../../mutations/snippet-instances.ts";
import { pathAt } from "../../path.ts";
import { errorResult, jsonResult, type McpResult, toMcp } from "./result.ts";
import {
  InnerPathSchema,
  jsonTolerant,
  NodeIdInputSchema,
  PatchRecordSchema,
  PathSchema,
  singleOrBulkError,
} from "./schemas.ts";

/**
 * Like toMcp, but on success attaches advisory `propWarnings` (typo'd
 * prop names, enum mismatches) so the agent can self-correct without a
 * follow-up inspect round-trip. Warnings never fail the mutation.
 */
async function toMcpWithWarnings<T>(
  result: Result<T, MutationError>,
  warn: (value: T) => Promise<string[]>,
): Promise<McpResult> {
  if (!result.ok) return errorResult(result.error);
  const propWarnings = await warn(result.value).catch(() => [] as string[]);
  return jsonResult(propWarnings.length > 0 ? { ...result.value, propWarnings } : result.value);
}

export function registerMutationTools(mcp: McpServer, ctx: MutationContext): void {
  // ── Tree mutations ─────────────────────────────────────────────────────
  mcp.registerTool(
    "add_node",
    {
      description:
        'Insert a node under parentPath ("@id" or path array). `componentRef` is required — this roots the new node at a library/extension component (its `children` may themselves include `{$snippet}` instances). To append a *snippet instance* directly under an existing parent (no wrapper component), use `instantiate_snippet` instead — it takes the same parentPath and is batchable, so stamp many in one `batch`. Pass `id` for a stable anchor. children carries full subtrees — build a whole card in one call.',
      inputSchema: {
        screenId: z.string(),
        parentPath: PathSchema,
        componentRef: z.string(),
        id: NodeIdInputSchema.optional(),
        props: PatchRecordSchema.optional(),
        propPatch: PatchRecordSchema.optional().describe(
          "Alias for `props`, accepted so the key matches update_props.",
        ),
        // `jsonTolerant` parses a stringified array (`children: "[{…}]"` — the most
        // common agent mistake) into a real array. A bare scalar (`children: "Save"`)
        // is still accepted past the SDK's arg check so the handler can answer with
        // the `props.children` nudge instead of the SDK's opaque "expected array".
        children: jsonTolerant(z.union([z.array(NodeSchema), z.string(), z.number()])).optional(),
        index: z.number().int().nonnegative().optional(),
        emitAs: z
          .object({ name: z.string().min(1), importPath: z.string().min(1) })
          .optional()
          .describe(
            "Host-component facade: render the subtree you build here, but emit_code emits `<name/>` from importPath instead — preserves a scanned app component's real identity.",
          ),
      },
    },
    async (args) => {
      if (typeof args.children === "string" || typeof args.children === "number") {
        return errorResult(
          badRequest("add_node: `children` must be an array of nodes.", [
            { code: "invalid_type", expected: "array", path: ["children"] },
          ]),
        );
      }
      const props = args.props ?? args.propPatch;
      const children = args.children;
      return toMcpWithWarnings(await addNode(ctx, { ...args, props, children }), async () => {
        const screen = ctx.folder.screens.get(args.screenId);
        if (!screen) return [];
        const inserted: Node = {
          $ref: args.componentRef,
          ...(props ? { props } : {}),
          ...(children ? { children } : {}),
        };
        return propWarningsForTree(ctx, screen, inserted);
      });
    },
  );

  mcp.registerTool(
    "update_props",
    {
      description:
        "Shallow-merge propPatch into the node at path (null removes a key; className restyles). For many nodes in one atomic write, pass `patches: [{ path, propPatch }]` instead. This patches a plain screen node; to patch a node *inside a snippet* use override_snippet_props (one instance only) or update_snippet's innerPatch (the shared definition, all instances).",
      inputSchema: {
        screenId: z.string(),
        path: PathSchema.optional(),
        propPatch: PatchRecordSchema.optional(),
        props: PatchRecordSchema.optional().describe(
          "Alias for `propPatch`, accepted so the key matches add_node.",
        ),
        patches: z
          .array(z.object({ path: PathSchema, propPatch: PatchRecordSchema }))
          .min(1)
          .optional()
          .describe("Bulk mode — mutually exclusive with path/propPatch"),
      },
    },
    async (args) => {
      const propPatch = args.propPatch ?? args.props;
      if (args.patches) {
        // Be liberal: if a single edit is ALSO passed, merge it into the bulk list
        // rather than rejecting — agents routinely conflate the two forms.
        const patches =
          args.path !== undefined && propPatch !== undefined
            ? [{ path: args.path, propPatch }, ...args.patches]
            : args.patches;
        const bulkArgs = { screenId: args.screenId, patches };
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
      if (args.path === undefined || propPatch === undefined) {
        return errorResult(
          badRequest(singleOrBulkError.missing("update_props", "path+propPatch", "patches")),
        );
      }
      const single = { screenId: args.screenId, path: args.path, propPatch };
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
    "set_style",
    {
      description:
        "Style a node through the screen's *native* channel — the framework adapter picks where the payload lands: a Tailwind `className` string (shadcn), an `sx` object (MUI), or a plain `style` object (no-framework). One verb across frameworks: pass a class string on a Tailwind folder, an object of properties on an sx/style folder. Objects merge shallowly (an inner `null` removes that key); `style: null` clears it entirely. A payload whose shape doesn't fit the channel is rejected with the expected shape. On a Tailwind folder this is equivalent to setting `className` via update_props.",
      inputSchema: {
        screenId: z.string(),
        path: PathSchema,
        style: jsonTolerant(z.union([z.string(), PatchRecordSchema, z.null()])).describe(
          "className string (Tailwind) or property object (sx/style); null clears.",
        ),
      },
    },
    async (args) => {
      return toMcpWithWarnings(
        await setStyle(ctx, { screenId: args.screenId, path: args.path, style: args.style }),
        async (value) => {
          const screen = ctx.folder.screens.get(args.screenId);
          if (!screen) return [];
          const node = pathAt(screen.tree, value.path);
          if (!node || !isComponentNode(node)) return [];
          // Surface prop warnings for object channels (sx keys), mirroring update_props.
          return typeof args.style === "object" && args.style !== null
            ? propWarnings(ctx, screen, node.$ref, args.style)
            : [];
        },
      );
    },
  );

  mcp.registerTool(
    "override_snippet_props",
    {
      description:
        'Patch props on one node INSIDE a snippet instance\'s body — the one-off escape hatch ("this instance\'s badge is red") without forking the snippet. path locates the instance; innerPath addresses the body node: "@id" when the body node carries a $id (preferred — survives body restructures), a dotted index path ("0.2" = third child of first child), or "" for the body root. Merges into the instance\'s $overrides; null values remove keys; an empty result clears the override. emit_code inlines overridden instances instead of emitting the shared component. Siblings: update_props patches a plain screen node; update_snippet\'s innerPatch changes the shared definition (every instance at once).',
      inputSchema: {
        screenId: z.string(),
        path: PathSchema,
        innerPath: InnerPathSchema,
        propPatch: PatchRecordSchema,
      },
    },
    async (args) => toMcp(await overrideSnippetProps(ctx, args)),
  );

  mcp.registerTool(
    "remove_node",
    {
      description:
        'Remove the node at path. A root locator ([] or "@root") clears ALL the root\'s children in one call — the fast way to empty a placeholder screen before rebuilding (or use set_screen_tree to replace the whole tree at once).',
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
        "Create a NEW screen. Does not place it on any board — call add_frame separately to surface it on the canvas. Pass `fromScreenId` to clone an existing screen's tree, or `tree` to supply one. Note: a route-scan already scaffolds one placeholder screen per detected route (id = route slug) — don't add_screen for those (it returns ScreenIdConflict); rebuild the existing screen with set_screen_tree (replaces the whole tree in one call), or build into it with add_node/instantiate_snippet. Omit `id` to auto-suffix a unique id.",
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
    "set_screen_tree",
    {
      description:
        "Replace a screen's ENTIRE tree in one call — the right tool for rebuilding a route-scan placeholder from scratch (no need to remove old nodes first, and no stale-index churn). The screen keeps its id, name, frames, and annotations; only the tree changes. Undoable like any mutation. Batchable.",
      inputSchema: {
        screenId: z.string(),
        tree: NodeSchema,
      },
    },
    async (args) =>
      toMcpWithWarnings(await setScreenTree(ctx, args), async () => {
        const screen = ctx.folder.screens.get(args.screenId);
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
      inputSchema: { name: z.string().max(MAX_BOARD_NAME_LENGTH), id: z.string().optional() },
    },
    async (args) => toMcp(await addBoard(ctx, args)),
  );

  mcp.registerTool(
    "update_board",
    {
      description:
        "Update a board's metadata. patch.theme names a theme (stem of theme/<name>.json) the board's frames render with — the per-board look; null clears back to the folder default. patch.archived: true files the board away (hidden from the sidebar, list_boards, and a default publish, but kept on disk and still editable); false restores it.",
      inputSchema: {
        boardId: z.string(),
        patch: z.object({
          name: z.string().max(MAX_BOARD_NAME_LENGTH).optional(),
          theme: z.string().nullable().optional(),
          archived: z.boolean().optional(),
        }),
      },
    },
    async (args) => toMcp(await updateBoard(ctx, args)),
  );

  mcp.registerTool(
    "remove_board",
    {
      description:
        "Delete a board and its notes. Permanent — to file a board away reversibly, prefer update_board { patch: { archived: true } }.",
      inputSchema: { boardId: z.string() },
    },
    async (args) => toMcp(await removeBoard(ctx, args)),
  );

  mcp.registerTool(
    "reorder_boards",
    {
      description:
        "Set the left-sidebar display order of boards. `order` is the list of board ids in the desired order; unknown ids are ignored and any omitted boards keep their current slots. Persisted to config.json (config.boardOrder).",
      inputSchema: { order: z.array(z.string()) },
    },
    async (args) => toMcp(await reorderBoards(ctx, args)),
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

  const FramePatchSchema = z.object({
    x: z.number().optional(),
    y: z.number().optional(),
    w: z.number().int().positive().optional(),
    h: z.number().int().positive().optional(),
    label: z.string().nullable().optional(),
    group: z.string().nullable().optional(),
  });

  mcp.registerTool(
    "update_frame",
    {
      description:
        "Move/resize/relabel/regroup a frame on a board (`label: null` or `group: null` clears). One frame: pass `frameId` + `patch`. For many frames in one atomic write — single persist + broadcast + undo entry — pass `patches: [{ frameId, patch }]` instead (the same single-or-bulk shape as update_props).",
      inputSchema: {
        boardId: z.string(),
        frameId: z.string().optional(),
        patch: FramePatchSchema.optional(),
        patches: z
          .array(z.object({ frameId: z.string(), patch: FramePatchSchema }))
          .min(1)
          .optional()
          .describe("Bulk mode — mutually exclusive with frameId/patch"),
      },
    },
    async (args) => {
      if (args.patches) {
        // Merge a single frame edit into the bulk list rather than rejecting.
        const patches =
          args.frameId !== undefined && args.patch !== undefined
            ? [{ frameId: args.frameId, patch: args.patch }, ...args.patches]
            : args.patches;
        return toMcp(await updateFrames(ctx, { boardId: args.boardId, patches }));
      }
      if (args.frameId === undefined || args.patch === undefined) {
        return errorResult(
          badRequest(singleOrBulkError.missing("update_frame", "frameId+patch", "patches")),
        );
      }
      return toMcp(
        await updateFrame(ctx, {
          boardId: args.boardId,
          frameId: args.frameId,
          patch: args.patch,
        }),
      );
    },
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
        'Create a reusable subtree. `params` declares typed inputs; placeholders inside the body are `{ "$param": "name" }` refs substituted at render time. Placement depends on the param type: a `node` param fills a child slot (put `{"$param":"slot"}` directly in a `children` array); a scalar param (string/number/boolean/icon/color/enum) fills a prop value (put `{"$param":"title"}` as a prop, e.g. `{"$ref":"Heading","props":{"children":{"$param":"title"}}}`). A scalar `$param` placed directly in a `children` array is an error — it renders as nothing.',
      inputSchema: {
        name: z.string(),
        id: z.string().optional(),
        params: z.array(SnippetParamSchema).default([]),
        tree: NodeSchema,
      },
    },
    async (args) =>
      toMcpWithWarnings(await addSnippet(ctx, args), async (value) =>
        dynamicIconWarningsForTree(value.snippet.tree),
      ),
  );

  mcp.registerTool(
    "update_snippet",
    {
      description:
        "Update a snippet's metadata or body. Sparse patch — pass only the fields to change. Every screen using the snippet is re-broadcast. To tweak ONE node's props inside the body without resending the whole tree, pass `innerPatch` — the definition-level member of the prop-patch trio: update_props (a plain screen node), override_snippet_props (one instance's body), update_snippet innerPatch (this — the shared definition, every instance at once). Pass `tree` only for a full body replacement.",
      inputSchema: {
        snippetId: z.string(),
        patch: z.object({
          name: z.string().optional(),
          params: z.array(SnippetParamSchema).optional(),
          tree: NodeSchema.optional(),
          innerPatch: z
            .object({
              innerPath: InnerPathSchema,
              propPatch: PatchRecordSchema,
            })
            .optional()
            .describe("Patch one body node's props in place; null values remove keys"),
        }),
      },
    },
    async (args) =>
      // Warn on the RESULTING tree (an update may patch the body via
      // `tree` or `innerPatch`), not just the incoming patch.
      toMcpWithWarnings(await updateSnippet(ctx, args), async (value) => {
        const warnings = [...(await dynamicIconWarningsForTree(value.snippet.tree))];
        // A params change can strand existing instances (now-missing required /
        // now-unknown args) that would otherwise only fail at render time inside
        // screenshot/compare_to_url — surface them here, where the change was made.
        if (args.patch.params !== undefined) {
          const declared = new Set(value.snippet.params.map((p) => p.name));
          for (const inst of findSnippetInstances(ctx.folder, value.snippet.id)) {
            const { missing } = resolveSnippetArgs(value.snippet, inst.args);
            const extras = Object.keys(inst.args).filter((k) => !declared.has(k));
            if (missing.length === 0 && extras.length === 0) continue;
            const parts = [
              missing.length ? `missing required: ${missing.join(", ")}` : "",
              extras.length ? `unknown: ${extras.join(", ")}` : "",
            ]
              .filter(Boolean)
              .join("; ");
            const at = inst.path === "" ? "the root" : `path [${inst.path.replace(/\./g, ",")}]`;
            warnings.push(
              `param change strands the instance on "${inst.screenId}" at ${at} (${parts}) — fix its args with update_snippet_args before rendering that screen`,
            );
          }
        }
        return warnings;
      }),
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
        "Add a `$snippet` instance to a screen tree under parentPath. `args` must satisfy the snippet's declared params — pass every required param (check `list_snippets`/`get_snippet` first: each param reports name, type, and `required`). Omitting a required param or passing an undeclared key returns SnippetParamMismatch listing the offending names. Pass `id` for a stable anchor; `extraClassName` to layer one-off Tailwind classes onto the snippet body's root; `overrides` to patch interior body nodes for THIS instance only (the active nav item, a red badge) at placement — no follow-up `override_snippet_props` needed. Stamp a shared snippet on many screens, each with its own `overrides`.",
      inputSchema: {
        screenId: z.string(),
        parentPath: PathSchema,
        snippetId: z.string(),
        id: NodeIdInputSchema.optional(),
        args: z.record(z.string(), z.unknown()).optional(),
        extraClassName: z.string().optional(),
        overrides: z
          .record(z.string(), z.object({ props: PatchRecordSchema }))
          .optional()
          .describe(
            'Per-instance interior prop patches, keyed by body-node selector: "@id" (preferred), a dotted index path like "0.2", or "" for the body root. e.g. {"@nav-dashboard": {"props": {"className": "bg-accent"}}}. Same field override_snippet_props patches on an already-placed instance.',
          ),
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
}
