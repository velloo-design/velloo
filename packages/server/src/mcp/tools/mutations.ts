import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  addBoardShape,
  addFrameShape,
  addScreenShape,
  addSnippetShape,
  moveNodeShape,
  normalizeUpdateSnippetInstance,
  removeBoardShape,
  removeFrameShape,
  removeNodeShape,
  removeScreenShape,
  removeSnippetShape,
  reorderBoardsShape,
  setNodeIdShape,
  updateBoardShape,
  updateFrameShape,
  updatePropsShape,
  updateScreenShape,
  updateSnippetInstanceShape,
  updateSnippetShape,
  updateViewportPresetsShape,
} from "@velloo/protocol";
import type { Result } from "@velloo/result";
import { isComponentNode, resolveSnippetArgs } from "@velloo/schema";
import { badRequest } from "../../mutations/errors.ts";
import {
  addBoard,
  addFrame,
  addScreen,
  addSnippet,
  type MutationContext,
  type MutationError,
  moveNode,
  removeBoard,
  removeFrame,
  removeNode,
  removeScreen,
  removeSnippet,
  reorderBoards,
  setNodeId,
  updateBoard,
  updateFrames,
  updateProps,
  updateScreen,
  updateSnippet,
  updateSnippetInstance,
  updateViewportPresets,
} from "../../mutations/index.ts";
import { resolve as resolveLocator } from "../../mutations/lookup.ts";
import {
  dynamicIconWarningsForTree,
  propWarnings,
  propWarningsForTree,
} from "../../mutations/prop-warnings.ts";
import { findSnippetInstances } from "../../mutations/snippet-instances.ts";
import { pathAt } from "../../path.ts";
import type { TailwindJit } from "../../styles/tailwind-jit.ts";
import {
  type DesignDiagnostic,
  diagnosticsForScreen,
  diagnosticsForTree,
  renderDiagnostics,
} from "../diagnostics.ts";
import { errorResult, jsonResult, type McpResult, toMcp } from "./result.ts";

/**
 * Like toMcp, but on success attaches advisory `propWarnings` (typo'd
 * prop names, enum mismatches) so the agent can self-correct without a
 * follow-up inspect round-trip. Warnings never fail the mutation.
 */
async function toMcpWithWarnings<T>(
  result: Result<T, MutationError>,
  warn: (value: T) => Promise<string[]>,
  diagnose?: ((value: T) => Promise<DesignDiagnostic[]>) | undefined,
): Promise<McpResult> {
  if (!result.ok) return errorResult(result.error);
  const [propWarnings, diagnostics] = await Promise.all([
    warn(result.value).catch(() => [] as string[]),
    diagnose?.(result.value).catch(() => [] as DesignDiagnostic[]) ?? [],
  ]);
  return jsonResult(
    propWarnings.length > 0 || diagnostics.length > 0
      ? {
          ...result.value,
          ...(propWarnings.length > 0 ? { propWarnings } : {}),
          ...(diagnostics.length > 0 ? { diagnostics } : {}),
        }
      : result.value,
  );
}

export function registerMutationTools(
  mcp: McpServer,
  ctx: MutationContext,
  jit?: TailwindJit,
): void {
  // ── Tree mutations ─────────────────────────────────────────────────────
  mcp.registerTool(
    "update_props",
    {
      description:
        "Patch nodes on a screen: one entry per node in `patches`, applied in one atomic write — length 1 for a single edit. `propPatch` shallow-merges props (null removes a key). `style` restyles through the screen's *native* channel, which the framework adapter routes to a Tailwind `className` string (shadcn), an `sx` object (MUI), or a plain `style` object; object channels merge shallowly and `style: null` clears. An entry may carry either or both. This patches plain screen nodes — for one inside a snippet, see velloo://guide/snippets.",
      inputSchema: updatePropsShape,
    },
    async (args) =>
      toMcpWithWarnings(
        await updateProps(ctx, args),
        async () => {
          const screen = ctx.folder.screens.get(args.screenId);
          if (!screen) return [];
          const all: string[] = [];
          for (const patch of args.patches) {
            const resolved = resolveLocator(screen.tree, patch.path, args.screenId);
            if (!resolved.ok) continue;
            const node = pathAt(screen.tree, resolved.value);
            if (node && isComponentNode(node)) {
              all.push(
                ...(await propWarnings(ctx, screen, node.$ref, patch.propPatch ?? {}, node.$repo)),
              );
            }
          }
          return all;
        },
        async () => {
          const screen = ctx.folder.screens.get(args.screenId);
          if (!screen) return [];
          // The static checks read only the patched subtrees; the render check
          // needs the screen whole, and once for all the patches.
          const all: DesignDiagnostic[] = renderDiagnostics(ctx, screen);
          for (const patch of args.patches) {
            const resolved = resolveLocator(screen.tree, patch.path, args.screenId);
            if (!resolved.ok) continue;
            const node = pathAt(screen.tree, resolved.value);
            if (node)
              all.push(...(await diagnosticsForTree(ctx, jit, screen, node, resolved.value)));
          }
          return all;
        },
      ),
  );

  mcp.registerTool(
    "remove_node",
    {
      description:
        'Remove the node at path. A root locator ([] or "@root") clears all root children; use `compose` mode "replace" when rebuilding the complete screen.',
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
        'Create a NEW screen. It is not placed on any board — call `add_frame` to surface it. Pass `fromScreenId` to clone an existing tree, or `tree` to supply one; omit `id` to auto-suffix a unique one. A route scan already scaffolds one placeholder screen per detected route (id = route slug), so don\'t add_screen for those — rebuild the existing screen with `compose` mode "replace".',
      inputSchema: addScreenShape,
    },
    async (args) =>
      toMcpWithWarnings(
        await addScreen(ctx, args),
        async () => {
          const created = args.id ?? "";
          const screen =
            ctx.folder.screens.get(created) ??
            [...ctx.folder.screens.values()].find((s) => s.name === args.name);
          return screen ? propWarningsForTree(ctx, screen, screen.tree) : [];
        },
        async () => {
          const created = args.id ?? "";
          const screen =
            ctx.folder.screens.get(created) ??
            [...ctx.folder.screens.values()].find((s) => s.name === args.name);
          return screen ? diagnosticsForScreen(ctx, jit, screen) : [];
        },
      ),
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
        "Create a new empty board — one infinite canvas of frames, and a folder can have many. `group` files it under a sidebar group: an existing group's name or id, or a new name to create that group. Guide: velloo://guide/boards.",
      inputSchema: addBoardShape,
    },
    async (args) => toMcp(await addBoard(ctx, args)),
  );

  mcp.registerTool(
    "update_board",
    {
      description:
        "Update a board's metadata. `theme` names a theme its frames render with — the per-board look; null clears back to the folder default. `archived: true` files the board away (hidden from the sidebar, list_boards and a default publish, but kept and still editable). `group` moves it to a sidebar group by existing name or id, a new name (which creates one), or null for Ungrouped. Guide: velloo://guide/boards.",
      inputSchema: updateBoardShape,
    },
    async (args) => toMcp(await updateBoard(ctx, args)),
  );

  mcp.registerTool(
    "remove_board",
    {
      description:
        "Delete a board and its notes. Screens no other board places are deleted with it and returned in `removedScreenIds`; screens also framed elsewhere are kept. Snippets those screens were the last to reach go too, in `removedSnippetIds` — a snippet already unreferenced before the call is left alone. Permanent — to file a board away reversibly, prefer update_board { patch: { archived: true } }.",
      inputSchema: removeBoardShape,
    },
    async (args) => toMcp(await removeBoard(ctx, args)),
  );

  mcp.registerTool(
    "reorder_boards",
    {
      description:
        "Set the left-sidebar display order of boards. `order` lists board ids in the desired order; unknown ids are ignored and omitted boards keep their current slots.",
      inputSchema: reorderBoardsShape,
    },
    async (args) => toMcp(await reorderBoards(ctx, args)),
  );

  mcp.registerTool(
    "update_viewport_presets",
    {
      description:
        "Replace the folder's viewport presets — the sizes offered when adding a frame. Send the complete list in display order; names must be distinct and at least one is required. Frames store their own w/h, so this never resizes an existing frame.",
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
        "Move, resize, relabel or regroup frames on a board: one entry per frame in `patches`, applied in one atomic write — length 1 for a single frame. `label`, `group` and `scheme` accept null to clear; an omitted field is unchanged. `scheme` pins a frame's render mode — a review affordance over the screen's one shared tree, not a separate design variant.",
      inputSchema: updateFrameShape,
    },
    async (args) => toMcp(await updateFrames(ctx, args)),
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
        'Create a reusable subtree with typed `params`; placeholders in the body are `{ "$param": "name" }`. **Structure that varies between instances is still ONE snippet: declare a `node` param** rather than inlining the repetition — the most expensive mistake here. Call `render_snippet` afterwards; $param wiring bugs are silent until instantiation. Guide: velloo://guide/snippets.',
      inputSchema: addSnippetShape,
    },
    async (args) =>
      toMcpWithWarnings(
        await addSnippet(ctx, args),
        async (value) => dynamicIconWarningsForTree(value.snippet.tree),
        async (value) => diagnosticsForTree(ctx, jit, value.snippet, value.snippet.tree),
      ),
  );

  mcp.registerTool(
    "update_snippet",
    {
      description:
        "Update a snippet's metadata or body; sparse patch, and every screen using it is re-broadcast. `innerPatch` retargets one node inside the body across every instance without resending the tree; pass `tree` only for a full body replacement. Guide: velloo://guide/snippets.",
      inputSchema: updateSnippetShape,
    },
    async (args) =>
      // Warn on the RESULTING tree (an update may patch the body via
      // `tree` or `innerPatch`), not just the incoming patch.
      toMcpWithWarnings(
        await updateSnippet(ctx, args),
        async (value) => {
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
                `param change strands the instance on "${inst.screenId}" at ${at} (${parts}) — fix its args with update_snippet_instance before rendering that screen`,
              );
            }
          }
          return warnings;
        },
        async (value) => diagnosticsForTree(ctx, jit, value.snippet, value.snippet.tree),
      ),
  );

  mcp.registerTool(
    "remove_snippet",
    {
      description:
        "Delete a snippet. Refuses with SnippetInUse while anything still instantiates it; the payload splits the referencers into `screenIds` (clear with remove_node) and `snippetIds` — other snippets whose body embeds this one (clear with update_snippet).",
      inputSchema: removeSnippetShape,
    },
    async (args) => toMcp(await removeSnippet(ctx, args)),
  );

  mcp.registerTool(
    "update_snippet_instance",
    {
      description:
        "Edit ONE snippet instance without touching the shared definition. `argPatch` changes what the caller passes in; `extraClassName` replaces its per-instance class suffix; `innerPath` + `propPatch` patch a node inside just this instance's body — the \"this card's badge is red\" escape hatch. They compose in one call. To change every instance instead, use `update_snippet`'s innerPatch. Guide: velloo://guide/snippets.",
      inputSchema: updateSnippetInstanceShape,
    },
    async (args) => {
      const plan = normalizeUpdateSnippetInstance(args);
      if (!plan.ok) return errorResult(badRequest(plan.message, plan.issues));
      return toMcpWithWarnings(
        await updateSnippetInstance(ctx, plan.args),
        async () => [],
        async () => {
          const screen = ctx.folder.screens.get(args.screenId);
          return screen ? diagnosticsForScreen(ctx, jit, screen) : [];
        },
      );
    },
  );
}
