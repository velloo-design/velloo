import { Hono } from "hono";
import {
  addBoard,
  addFrame,
  addGroup,
  addNode,
  addScreen,
  addSnippet,
  applyClasses,
  applyClassesBulk,
  instantiateSnippet,
  type MutationContext,
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
} from "../mutations/index.ts";
import {
  AddBoardBody,
  AddFrameBody,
  AddGroupBody,
  AddNodeBody,
  AddScreenBody,
  AddSnippetBody,
  ApplyClassesBody,
  ApplyClassesBulkBody,
  InstantiateSnippetBody,
  MoveNodeBody,
  RemoveBoardBody,
  RemoveFrameBody,
  RemoveGroupBody,
  RemoveNodeBody,
  RemoveScreenBody,
  RemoveSnippetBody,
  SetNodeIdBody,
  UpdateBoardBody,
  UpdateFrameBody,
  UpdateFramesBody,
  UpdateGroupBody,
  UpdatePropsBody,
  UpdatePropsBulkBody,
  UpdateScreenBody,
  UpdateSnippetArgsBody,
  UpdateSnippetBody,
} from "./mutate-schemas.ts";
import { makeRoute } from "./route.ts";

export function createMutateRouter(ctxFor: () => MutationContext): Hono {
  const r = new Hono();
  const route = makeRoute(ctxFor);

  // Tree mutations
  r.post(
    "/add_node",
    route(AddNodeBody, (a, ctx) => addNode(ctx, a)),
  );
  r.post(
    "/update_props",
    route(UpdatePropsBody, (a, ctx) => updateProps(ctx, a)),
  );
  r.post(
    "/remove_node",
    route(RemoveNodeBody, (a, ctx) => removeNode(ctx, a)),
  );
  r.post(
    "/move_node",
    route(MoveNodeBody, (a, ctx) => moveNode(ctx, a)),
  );
  r.post(
    "/apply_classes",
    route(ApplyClassesBody, (a, ctx) => applyClasses(ctx, a)),
  );
  r.post(
    "/apply_classes_bulk",
    route(ApplyClassesBulkBody, (a, ctx) => applyClassesBulk(ctx, a)),
  );
  r.post(
    "/update_props_bulk",
    route(UpdatePropsBulkBody, (a, ctx) => updatePropsBulk(ctx, a)),
  );
  r.post(
    "/set_node_id",
    route(SetNodeIdBody, (a, ctx) => setNodeId(ctx, a)),
  );

  // Screen lifecycle
  r.post(
    "/add_screen",
    route(AddScreenBody, (a, ctx) => addScreen(ctx, a)),
  );
  r.post(
    "/remove_screen",
    route(RemoveScreenBody, (a, ctx) => removeScreen(ctx, a)),
  );
  r.post(
    "/update_screen",
    route(UpdateScreenBody, (a, ctx) => updateScreen(ctx, a)),
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

  // Frame / group lifecycle
  r.post(
    "/add_frame",
    route(AddFrameBody, (a, ctx) => addFrame(ctx, a)),
  );
  r.post(
    "/update_frame",
    route(UpdateFrameBody, (a, ctx) => updateFrame(ctx, a)),
  );
  r.post(
    "/update_frames",
    route(UpdateFramesBody, (a, ctx) => updateFrames(ctx, a)),
  );
  r.post(
    "/remove_frame",
    route(RemoveFrameBody, (a, ctx) => removeFrame(ctx, a)),
  );
  r.post(
    "/add_group",
    route(AddGroupBody, (a, ctx) => addGroup(ctx, a)),
  );
  r.post(
    "/update_group",
    route(UpdateGroupBody, (a, ctx) => updateGroup(ctx, a)),
  );
  r.post(
    "/remove_group",
    route(RemoveGroupBody, (a, ctx) => removeGroup(ctx, a)),
  );

  // Snippets
  r.post(
    "/add_snippet",
    route(AddSnippetBody, (a, ctx) => addSnippet(ctx, a)),
  );
  r.post(
    "/update_snippet",
    route(UpdateSnippetBody, (a, ctx) => updateSnippet(ctx, a)),
  );
  r.post(
    "/remove_snippet",
    route(RemoveSnippetBody, (a, ctx) => removeSnippet(ctx, a)),
  );
  r.post(
    "/instantiate_snippet",
    route(InstantiateSnippetBody, (a, ctx) => instantiateSnippet(ctx, a)),
  );
  r.post(
    "/update_snippet_args",
    route(UpdateSnippetArgsBody, (a, ctx) => updateSnippetArgs(ctx, a)),
  );

  return r;
}
