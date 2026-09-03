import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  addBoardShape,
  addFrameShape,
  addNodeShape,
  addScreenShape,
  addSnippetShape,
  instantiateSnippetShape,
  moveNodeShape,
  normalizeAddNode,
  normalizeUpdateFrame,
  normalizeUpdateProps,
  overrideSnippetPropsShape,
  removeBoardShape,
  removeFrameShape,
  removeNodeShape,
  removeScreenShape,
  removeSnippetShape,
  reorderBoardsShape,
  setNodeIdShape,
  setScreenTreeShape,
  setStyleShape,
  updateBoardShape,
  updateFrameShape,
  updatePropsShape,
  updateScreenShape,
  updateSnippetArgsShape,
  updateSnippetShape,
  updateViewportPresetsShape,
} from "@velloo/protocol";
import type { Result } from "@velloo/result";
import { isComponentNode, type Node, resolveSnippetArgs } from "@velloo/schema";
import { badRequest } from "../../mutations/errors.ts";
import {
  addBoard,
  addFrame,
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
  removeNode,
  removeScreen,
  removeSnippet,
  reorderBoards,
  setNodeId,
  setScreenTree,
  setStyle,
  type UpdateFrameResult,
  type UpdateFramesResult,
  updateBoard,
  updateFrame,
  updateFrames,
  updateProps,
  updatePropsBulk,
  updateScreen,
  updateSnippet,
  updateSnippetArgs,
  updateViewportPresets,
} from "../../mutations/index.ts";
import {
  dynamicIconWarningsForTree,
  propWarnings,
  propWarningsForTree,
} from "../../mutations/prop-warnings.ts";
import { findSnippetInstances } from "../../mutations/snippet-instances.ts";
import { pathAt } from "../../path.ts";
import { errorResult, jsonResult, type McpResult, toMcp } from "./result.ts";

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
      inputSchema: addNodeShape,
    },
    async (args) => {
      const normalized = normalizeAddNode(args);
      if (!normalized.ok) {
        return errorResult(badRequest(normalized.message, normalized.issues));
      }
      const { props, children } = normalized.args;
      return toMcpWithWarnings(await addNode(ctx, normalized.args), async () => {
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
      inputSchema: updatePropsShape,
    },
    async (args) => {
      const plan = normalizeUpdateProps(args);
      if (!plan.ok) return errorResult(badRequest(plan.message, plan.issues));
      if (plan.args.mode === "bulk") {
        const bulkArgs = plan.args.args;
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
      const single = plan.args.args;
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
      inputSchema: setStyleShape,
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
      inputSchema: overrideSnippetPropsShape,
    },
    async (args) => toMcp(await overrideSnippetProps(ctx, args)),
  );

  mcp.registerTool(
    "remove_node",
    {
      description:
        'Remove the node at path. A root locator ([] or "@root") clears ALL the root\'s children in one call — the fast way to empty a placeholder screen before rebuilding (or use set_screen_tree to replace the whole tree at once).',
      inputSchema: removeNodeShape,
    },
    async (args) => toMcp(await removeNode(ctx, args)),
  );

  mcp.registerTool(
    "move_node",
    {
      description:
        "Move a node from fromPath to a new parent. toIndex is the insertion index in the destination's children.",
      inputSchema: moveNodeShape,
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
      inputSchema: setNodeIdShape,
    },
    async (args) => toMcp(await setNodeId(ctx, args)),
  );

  // ── Screen lifecycle ───────────────────────────────────────────────────
  mcp.registerTool(
    "add_screen",
    {
      description:
        "Create a NEW screen. Does not place it on any board — call add_frame separately to surface it on the canvas. Pass `fromScreenId` to clone an existing screen's tree, or `tree` to supply one. Note: a route-scan already scaffolds one placeholder screen per detected route (id = route slug) — don't add_screen for those (it returns ScreenIdConflict); rebuild the existing screen with set_screen_tree (replaces the whole tree in one call), or build into it with add_node/instantiate_snippet. Omit `id` to auto-suffix a unique id.",
      inputSchema: addScreenShape,
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
      inputSchema: setScreenTreeShape,
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
      inputSchema: updateScreenShape,
    },
    async (args) => toMcp(await updateScreen(ctx, args)),
  );

  mcp.registerTool(
    "remove_screen",
    {
      description:
        "Delete a screen. Refuses if it's the last screen. If any frames reference the screen, they're returned in `removedFrameIds` (cascaded removal).",
      inputSchema: removeScreenShape,
    },
    async (args) => toMcp(await removeScreen(ctx, args)),
  );

  // ── Board lifecycle ────────────────────────────────────────────────────
  mcp.registerTool(
    "add_board",
    {
      description:
        'Create a new empty board. A board is one infinite canvas of frames; a design folder can have many. `group` files it under a sidebar group — pass an existing group\'s name (or id), or a new name to create that group. Groups are areas of work ("Side pane", "Account page"); everything ungrouped shows under Ungrouped.',
      inputSchema: addBoardShape,
    },
    async (args) => toMcp(await addBoard(ctx, args)),
  );

  mcp.registerTool(
    "update_board",
    {
      description:
        "Update a board's metadata. patch.theme names a theme (stem of theme/<name>.json) the board's frames render with — the per-board look; null clears back to the folder default. patch.archived: true files the board away (hidden from the sidebar, list_boards, and a default publish, but kept on disk and still editable); false restores it. patch.group moves the board to a sidebar group — an existing group's name or id, a new name (which creates the group), or null for Ungrouped.",
      inputSchema: updateBoardShape,
    },
    async (args) => toMcp(await updateBoard(ctx, args)),
  );

  mcp.registerTool(
    "remove_board",
    {
      description:
        "Delete a board and its notes. Permanent — to file a board away reversibly, prefer update_board { patch: { archived: true } }.",
      inputSchema: removeBoardShape,
    },
    async (args) => toMcp(await removeBoard(ctx, args)),
  );

  mcp.registerTool(
    "reorder_boards",
    {
      description:
        "Set the left-sidebar display order of boards. `order` is the list of board ids in the desired order; unknown ids are ignored and any omitted boards keep their current slots. Persisted to config.json (config.boardOrder).",
      inputSchema: reorderBoardsShape,
    },
    async (args) => toMcp(await reorderBoards(ctx, args)),
  );

  mcp.registerTool(
    "update_viewport_presets",
    {
      description:
        "Replace the folder's viewport presets (config.viewportPresets) \u2014 the sizes offered when adding a frame. Send the complete list in display order; names must be distinct and at least one preset is required. Frames store their own w/h, so editing presets never resizes an existing frame.",
      inputSchema: updateViewportPresetsShape,
    },
    async (args) => toMcp(await updateViewportPresets(ctx, args)),
  );

  // ── Frame / group lifecycle ────────────────────────────────────────────
  mcp.registerTool(
    "add_frame",
    {
      description:
        "Place a screen on a specific board at a chosen size + position. x/y default to a free spot on that board.",
      inputSchema: addFrameShape,
    },
    async (args) => toMcp(await addFrame(ctx, args)),
  );

  mcp.registerTool(
    "update_frame",
    {
      description:
        'Move/resize/relabel/regroup a frame on a board. `label: null`, `group: null`, or `scheme: null` clears that field; omitting a field leaves it unchanged. `scheme: "light" | "dark"` pins this frame\'s render scheme; it is a review affordance over the screen\'s one shared tree, not a separate design variant. One frame: pass `frameId` + `patch`. For many frames in one atomic write — single persist + broadcast + undo entry — pass `patches: [{ frameId, patch }]` instead (the same single-or-bulk shape as update_props).',
      inputSchema: updateFrameShape,
    },
    async (args) => {
      const plan = normalizeUpdateFrame(args);
      if (!plan.ok) return errorResult(badRequest(plan.message, plan.issues));
      const result: Result<UpdateFrameResult | UpdateFramesResult, MutationError> =
        plan.args.mode === "bulk"
          ? await updateFrames(ctx, plan.args.args)
          : await updateFrame(ctx, plan.args.args);
      return toMcp(result);
    },
  );

  mcp.registerTool(
    "remove_frame",
    {
      description: "Remove a frame placement from a board. The underlying screen is left intact.",
      inputSchema: removeFrameShape,
    },
    async (args) => toMcp(await removeFrame(ctx, args)),
  );

  // ── Snippets ────────────────────────────────────────────────────────────
  mcp.registerTool(
    "add_snippet",
    {
      description:
        'Create a reusable subtree. `params` declares typed inputs; placeholders inside the body are `{ "$param": "name" }` refs substituted at render time. Placement depends on the param type: a `node` param fills a child slot (put `{"$param":"slot"}` directly in a `children` array); a scalar param (string/number/boolean/icon/color/enum) fills a prop value (put `{"$param":"title"}` as a prop, e.g. `{"$ref":"Heading","props":{"children":{"$param":"title"}}}`). A scalar `$param` placed directly in a `children` array is an error — it renders as nothing.\n\n**If the STRUCTURE varies between instances, that is still one snippet — declare a `node` param.** Rows whose leading mark is an icon, or a logo, or nothing at all are three fillings of one `node` slot, not three snippets and not a reason to inline the repetition. Add `optional: true` and an omitted slot renders and emits nothing, so the "or nothing at all" case needs no placeholder. A `node` param accepts one node or an array that renders as siblings. Only scalar values belong in scalar params: notably an `icon` param bakes ONE lucide glyph into the emitted JSX for every instance, so a per-instance icon must be a `node` param. Inlining repeated structure instead of parameterizing it is the most common and most expensive mistake here — it bloats the screen JSON and turns every later edit into N edits.',
      inputSchema: addSnippetShape,
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
      inputSchema: updateSnippetShape,
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
      inputSchema: removeSnippetShape,
    },
    async (args) => toMcp(await removeSnippet(ctx, args)),
  );

  mcp.registerTool(
    "instantiate_snippet",
    {
      description:
        "Add a `$snippet` instance to a screen tree under parentPath. `args` must satisfy the snippet's declared params — pass every required param (check `list_snippets`/`get_snippet` first: each param reports name, type, and `required`). Omitting a required param or passing an undeclared key returns SnippetParamMismatch listing the offending names. Pass `id` for a stable anchor; `extraClassName` to layer one-off Tailwind classes onto the snippet body's root; `overrides` to patch interior body nodes for THIS instance only (the active nav item, a red badge) at placement — no follow-up `override_snippet_props` needed. Stamp a shared snippet on many screens, each with its own `overrides`.",
      inputSchema: instantiateSnippetShape,
    },
    async (args) => toMcp(await instantiateSnippet(ctx, args)),
  );

  mcp.registerTool(
    "update_snippet_args",
    {
      description:
        "Patch the `args` of a snippet instance without touching the snippet body. `null` in argPatch removes a key. Pass `extraClassName` to replace the instance's per-instance className override; `null` clears it.",
      inputSchema: updateSnippetArgsShape,
    },
    async (args) => toMcp(await updateSnippetArgs(ctx, args)),
  );
}
