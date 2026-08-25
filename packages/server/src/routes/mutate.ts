import { Hono } from "hono";
import {
  addBoard,
  applyClasses,
  type MutationContext,
  removeBoard,
  removeFrame,
  reorderBoards,
  setNodeId,
  updateFrame,
  updateProps,
  updateSnippet,
  updateSnippetArgs,
} from "../mutations/index.ts";
import {
  AddBoardBody,
  ApplyClassesBody,
  RemoveBoardBody,
  RemoveFrameBody,
  ReorderBoardsBody,
  SetNodeIdBody,
  UpdateFrameBody,
  UpdatePropsBody,
  UpdateSnippetArgsBody,
  UpdateSnippetBody,
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
    "/remove_board",
    route(RemoveBoardBody, (a, ctx) => removeBoard(ctx, a)),
  );
  r.post(
    "/reorder_boards",
    route(ReorderBoardsBody, (a, ctx) => reorderBoards(ctx, a)),
  );

  // Frame lifecycle
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
