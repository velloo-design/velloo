import { Hono } from "hono";
import {
  addNode,
  addPage,
  addVariant,
  applyClasses,
  type MutationContext,
  moveNode,
  removeNode,
  removePage,
  removeVariant,
  updateProps,
  updateVariant,
  updateVariants,
} from "../mutations/index.ts";
import { coercePath } from "../path.ts";
import { mutationToHttp } from "./mutation-http.ts";

interface AnyArgs {
  pageId?: string;
  variantId?: string;
  parentPath?: unknown;
  path?: unknown;
  fromPath?: unknown;
  toParent?: unknown;
  toIndex?: number;
  componentRef?: string;
  fromVariantId?: string;
  viewport?: { w: number; h: number };
  name?: string;
  id?: string;
  index?: number;
  props?: Record<string, unknown>;
  children?: unknown;
  propPatch?: Record<string, unknown>;
  classes?: string;
  patch?: {
    name?: string;
    viewport?: { w: number; h: number };
    position?: { x: number; y: number } | null;
  };
  patches?: Array<{
    variantId: string;
    patch: {
      name?: string;
      viewport?: { w: number; h: number };
      position?: { x: number; y: number } | null;
    };
  }>;
}

function bad(reason: string) {
  return { error: { kind: "BadRequest", message: reason } };
}

export function createMutateRouter(ctxFor: () => MutationContext): Hono {
  const r = new Hono();

  r.post("/add_node", async (c) => {
    const args = (await c.req.json()) as AnyArgs;
    if (!args.pageId || !args.variantId || !args.componentRef) {
      return c.json(bad("pageId, variantId, componentRef are required"), 400);
    }
    const result = await addNode(ctxFor(), {
      pageId: args.pageId,
      variantId: args.variantId,
      parentPath: coercePath(args.parentPath ?? []),
      componentRef: args.componentRef,
      props: args.props,
      children: (args.children as never) ?? undefined,
      index: args.index,
    });
    return result.ok ? c.json(result.value) : mutationToHttp(c, result.error);
  });

  r.post("/update_props", async (c) => {
    const args = (await c.req.json()) as AnyArgs;
    if (!args.pageId || !args.variantId || !args.propPatch) {
      return c.json(bad("pageId, variantId, propPatch are required"), 400);
    }
    const result = await updateProps(ctxFor(), {
      pageId: args.pageId,
      variantId: args.variantId,
      path: coercePath(args.path ?? []),
      propPatch: args.propPatch,
    });
    return result.ok ? c.json(result.value) : mutationToHttp(c, result.error);
  });

  r.post("/remove_node", async (c) => {
    const args = (await c.req.json()) as AnyArgs;
    if (!args.pageId || !args.variantId) return c.json(bad("pageId, variantId required"), 400);
    const result = await removeNode(ctxFor(), {
      pageId: args.pageId,
      variantId: args.variantId,
      path: coercePath(args.path ?? []),
    });
    return result.ok ? c.json(result.value) : mutationToHttp(c, result.error);
  });

  r.post("/move_node", async (c) => {
    const args = (await c.req.json()) as AnyArgs;
    if (
      !args.pageId ||
      !args.variantId ||
      args.fromPath === undefined ||
      args.toParent === undefined
    ) {
      return c.json(bad("pageId, variantId, fromPath, toParent required"), 400);
    }
    const result = await moveNode(ctxFor(), {
      pageId: args.pageId,
      variantId: args.variantId,
      fromPath: coercePath(args.fromPath),
      toParent: coercePath(args.toParent),
      toIndex: args.toIndex,
    });
    return result.ok ? c.json(result.value) : mutationToHttp(c, result.error);
  });

  r.post("/add_variant", async (c) => {
    const args = (await c.req.json()) as AnyArgs;
    if (!args.pageId || !args.viewport || !args.name) {
      return c.json(bad("pageId, viewport, name required"), 400);
    }
    const result = await addVariant(ctxFor(), {
      pageId: args.pageId,
      fromVariantId: args.fromVariantId,
      viewport: args.viewport,
      name: args.name,
      id: args.id,
    });
    return result.ok ? c.json(result.value) : mutationToHttp(c, result.error);
  });

  r.post("/add_page", async (c) => {
    const args = (await c.req.json()) as AnyArgs;
    if (!args.name) return c.json(bad("name required"), 400);
    const result = await addPage(ctxFor(), {
      name: args.name,
      id: args.id,
      viewport: args.viewport,
    });
    return result.ok ? c.json(result.value) : mutationToHttp(c, result.error);
  });

  r.post("/remove_page", async (c) => {
    const args = (await c.req.json()) as AnyArgs;
    if (!args.pageId) return c.json(bad("pageId required"), 400);
    const result = await removePage(ctxFor(), { pageId: args.pageId });
    return result.ok ? c.json(result.value) : mutationToHttp(c, result.error);
  });

  r.post("/remove_variant", async (c) => {
    const args = (await c.req.json()) as AnyArgs;
    if (!args.pageId || !args.variantId) return c.json(bad("pageId, variantId required"), 400);
    const result = await removeVariant(ctxFor(), {
      pageId: args.pageId,
      variantId: args.variantId,
    });
    return result.ok ? c.json(result.value) : mutationToHttp(c, result.error);
  });

  r.post("/update_variant", async (c) => {
    const args = (await c.req.json()) as AnyArgs;
    if (!args.pageId || !args.variantId || !args.patch) {
      return c.json(bad("pageId, variantId, patch required"), 400);
    }
    const result = await updateVariant(ctxFor(), {
      pageId: args.pageId,
      variantId: args.variantId,
      patch: args.patch,
    });
    return result.ok ? c.json(result.value) : mutationToHttp(c, result.error);
  });

  r.post("/update_variants", async (c) => {
    const args = (await c.req.json()) as AnyArgs;
    if (!args.pageId || !Array.isArray(args.patches)) {
      return c.json(bad("pageId, patches required"), 400);
    }
    const result = await updateVariants(ctxFor(), {
      pageId: args.pageId,
      patches: args.patches,
    });
    return result.ok ? c.json(result.value) : mutationToHttp(c, result.error);
  });

  r.post("/apply_classes", async (c) => {
    const args = (await c.req.json()) as AnyArgs;
    if (!args.pageId || !args.variantId || typeof args.classes !== "string") {
      return c.json(bad("pageId, variantId, classes required"), 400);
    }
    const result = await applyClasses(ctxFor(), {
      pageId: args.pageId,
      variantId: args.variantId,
      path: coercePath(args.path ?? []),
      classes: args.classes,
    });
    return result.ok ? c.json(result.value) : mutationToHttp(c, result.error);
  });

  return r;
}
