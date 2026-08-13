import { Hono } from "hono";
import {
  addNode,
  addPage,
  addSnippet,
  addVariant,
  applyClasses,
  instantiateSnippet,
  type MutationContext,
  moveNode,
  removeNode,
  removePage,
  removeSnippet,
  removeVariant,
  updatePage,
  updateProps,
  updateSnippet,
  updateSnippetArgs,
  updateVariant,
  updateVariants,
} from "../mutations/index.ts";
import {
  AddNodeBody,
  AddPageBody,
  AddSnippetBody,
  AddVariantBody,
  ApplyClassesBody,
  InstantiateSnippetBody,
  MoveNodeBody,
  RemoveNodeBody,
  RemovePageBody,
  RemoveSnippetBody,
  RemoveVariantBody,
  UpdatePageBody,
  UpdatePropsBody,
  UpdateSnippetArgsBody,
  UpdateSnippetBody,
  UpdateVariantBody,
  UpdateVariantsBody,
} from "./mutate-schemas.ts";
import { makeRoute } from "./route.ts";

export function createMutateRouter(ctxFor: () => MutationContext): Hono {
  const r = new Hono();
  const route = makeRoute(ctxFor);

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
    "/add_variant",
    route(AddVariantBody, (a, ctx) => addVariant(ctx, a)),
  );
  r.post(
    "/remove_variant",
    route(RemoveVariantBody, (a, ctx) => removeVariant(ctx, a)),
  );
  r.post(
    "/update_variant",
    route(UpdateVariantBody, (a, ctx) => updateVariant(ctx, a)),
  );
  r.post(
    "/update_variants",
    route(UpdateVariantsBody, (a, ctx) => updateVariants(ctx, a)),
  );
  r.post(
    "/add_page",
    route(AddPageBody, (a, ctx) => addPage(ctx, a)),
  );
  r.post(
    "/remove_page",
    route(RemovePageBody, (a, ctx) => removePage(ctx, a)),
  );
  r.post(
    "/update_page",
    route(UpdatePageBody, (a, ctx) => updatePage(ctx, a)),
  );
  r.post(
    "/apply_classes",
    route(ApplyClassesBody, (a, ctx) => applyClasses(ctx, a)),
  );
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
