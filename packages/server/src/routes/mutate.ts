import { Hono } from "hono";
import {
  addBoard,
  addBoardGroup,
  addFrame,
  applyClasses,
  type MutationContext,
  removeBoard,
  removeBoardGroup,
  removeFrame,
  reorderBoardGroups,
  reorderBoards,
  setNodeId,
  updateBoard,
  updateBoardGroup,
  updateCodegen,
  updateDefaults,
  updateFeedback,
  updateFrame,
  updateProps,
  updateSnippet,
  updateSnippetArgs,
  updateViewportPresets,
} from "../mutations/index.ts";
import {
  AddBoardBody,
  AddBoardGroupBody,
  AddFrameBody,
  ApplyClassesBody,
  RemoveBoardBody,
  RemoveBoardGroupBody,
  RemoveFrameBody,
  ReorderBoardGroupsBody,
  ReorderBoardsBody,
  SetNodeIdBody,
  UpdateBoardBody,
  UpdateBoardGroupBody,
  UpdateCodegenBody,
  UpdateDefaultsBody,
  UpdateFeedbackBody,
  UpdateFrameBody,
  UpdatePropsBody,
  UpdateSnippetArgsBody,
  UpdateSnippetBody,
  UpdateViewportPresetsBody,
} from "./mutate-schemas.ts";
import { makeRoute } from "./route.ts";

/**
 * The canvas's HTTP mutation surface. Only the ops the canvas SPA actually
 * posts live here — the MCP tools call the mutation functions in
 * `mutations/index.ts` directly (never over HTTP), so their impls stay exported
 * even though most have no route.
 */
export function createMutateRouter(ctxFor: () => MutationContext): Hono {
  const r = new Hono();
  const route = makeRoute(ctxFor);

  // Tree mutations
  r.post(
    "/update_props",
    route(UpdatePropsBody, (a, ctx) => updateProps(ctx, a)),
  );
  r.post(
    "/apply_classes",
    route(ApplyClassesBody, (a, ctx) => applyClasses(ctx, a)),
  );
  r.post(
    "/set_node_id",
    route(SetNodeIdBody, (a, ctx) => setNodeId(ctx, a)),
  );

  // Board lifecycle
  r.post(
    "/add_board",
    route(AddBoardBody, (a, ctx) => addBoard(ctx, a)),
  );
  r.post(
    "/update_board",
    route(UpdateBoardBody, (a, ctx) => updateBoard(ctx, a)),
  );
  r.post(
    "/remove_board",
    route(RemoveBoardBody, (a, ctx) => removeBoard(ctx, a)),
  );
  r.post(
    "/reorder_boards",
    route(ReorderBoardsBody, (a, ctx) => reorderBoards(ctx, a)),
  );

  // Board groups — canvas-only: agents file a board with update_board's
  // `group`, they never manage the groups themselves.
  r.post(
    "/add_board_group",
    route(AddBoardGroupBody, (a, ctx) => addBoardGroup(ctx, a)),
  );
  r.post(
    "/update_board_group",
    route(UpdateBoardGroupBody, (a, ctx) => updateBoardGroup(ctx, a)),
  );
  r.post(
    "/remove_board_group",
    route(RemoveBoardGroupBody, (a, ctx) => removeBoardGroup(ctx, a)),
  );
  r.post(
    "/reorder_board_groups",
    route(ReorderBoardGroupsBody, (a, ctx) => reorderBoardGroups(ctx, a)),
  );

  // Folder config
  r.post(
    "/update_viewport_presets",
    route(UpdateViewportPresetsBody, (a, ctx) => updateViewportPresets(ctx, a)),
  );
  r.post(
    "/update_defaults",
    route(UpdateDefaultsBody, (a, ctx) => updateDefaults(ctx, a)),
  );
  r.post(
    "/update_codegen",
    route(UpdateCodegenBody, (a, ctx) => updateCodegen(ctx, a)),
  );
  r.post(
    "/update_feedback",
    route(UpdateFeedbackBody, (a, ctx) => updateFeedback(ctx, a)),
  );

  // Frame lifecycle
  r.post(
    "/add_frame",
    route(AddFrameBody, (a, ctx) => addFrame(ctx, a)),
  );
  r.post(
    "/update_frame",
    route(UpdateFrameBody, (a, ctx) => updateFrame(ctx, a)),
  );
  r.post(
    "/remove_frame",
    route(RemoveFrameBody, (a, ctx) => removeFrame(ctx, a)),
  );

  // Snippets
  r.post(
    "/update_snippet",
    route(UpdateSnippetBody, (a, ctx) => updateSnippet(ctx, a)),
  );
  r.post(
    "/update_snippet_args",
    route(UpdateSnippetArgsBody, (a, ctx) => updateSnippetArgs(ctx, a)),
  );

  return r;
}
