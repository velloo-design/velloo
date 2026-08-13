import { NodeSchema, SnippetParamSchema } from "@velloo/schema";
import { z } from "zod";

const Path = z.array(z.number().int().nonnegative());
const Viewport = z.object({
  w: z.number().int().positive(),
  h: z.number().int().positive(),
});
const Position = z.object({ x: z.number(), y: z.number() });
const VariantPatch = z.object({
  name: z.string().min(1).optional(),
  viewport: Viewport.optional(),
  position: Position.nullable().optional(),
});

export const AddNodeBody = z.object({
  pageId: z.string().min(1),
  variantId: z.string().min(1),
  parentPath: Path.default([]),
  componentRef: z.string().min(1),
  props: z.record(z.string(), z.unknown()).optional(),
  children: z.array(NodeSchema).optional(),
  index: z.number().int().nonnegative().optional(),
});

export const UpdatePropsBody = z.object({
  pageId: z.string().min(1),
  variantId: z.string().min(1),
  path: Path.default([]),
  propPatch: z.record(z.string(), z.unknown()),
});

export const RemoveNodeBody = z.object({
  pageId: z.string().min(1),
  variantId: z.string().min(1),
  path: Path.default([]),
});

export const MoveNodeBody = z.object({
  pageId: z.string().min(1),
  variantId: z.string().min(1),
  fromPath: Path,
  toParent: Path,
  toIndex: z.number().int().nonnegative().optional(),
});

export const AddVariantBody = z.object({
  pageId: z.string().min(1),
  fromVariantId: z.string().min(1).optional(),
  viewport: Viewport,
  name: z.string().min(1),
  id: z.string().min(1).optional(),
});

export const RemoveVariantBody = z.object({
  pageId: z.string().min(1),
  variantId: z.string().min(1),
});

export const UpdateVariantBody = z.object({
  pageId: z.string().min(1),
  variantId: z.string().min(1),
  patch: VariantPatch,
});

export const UpdateVariantsBody = z.object({
  pageId: z.string().min(1),
  patches: z
    .array(
      z.object({
        variantId: z.string().min(1),
        patch: VariantPatch,
      }),
    )
    .min(1),
});

export const AddPageBody = z.object({
  name: z.string().min(1),
  id: z.string().min(1).optional(),
  viewport: Viewport.optional(),
});

export const RemovePageBody = z.object({
  pageId: z.string().min(1),
});

export const UpdatePageBody = z.object({
  pageId: z.string().min(1),
  patch: z.object({
    name: z.string().min(1).optional(),
  }),
});

export const ApplyClassesBody = z.object({
  pageId: z.string().min(1),
  variantId: z.string().min(1),
  path: Path.default([]),
  classes: z.string(),
});

export const AddSnippetBody = z.object({
  name: z.string().min(1),
  id: z.string().min(1).optional(),
  params: z.array(SnippetParamSchema).default([]),
  tree: NodeSchema,
});

export const UpdateSnippetBody = z.object({
  snippetId: z.string().min(1),
  patch: z.object({
    name: z.string().min(1).optional(),
    params: z.array(SnippetParamSchema).optional(),
    tree: NodeSchema.optional(),
  }),
});

export const RemoveSnippetBody = z.object({
  snippetId: z.string().min(1),
});

export const InstantiateSnippetBody = z.object({
  pageId: z.string().min(1),
  variantId: z.string().min(1),
  parentPath: Path.default([]),
  snippetId: z.string().min(1),
  args: z.record(z.string(), z.unknown()).optional(),
  index: z.number().int().nonnegative().optional(),
});

export const UpdateSnippetArgsBody = z.object({
  pageId: z.string().min(1),
  variantId: z.string().min(1),
  path: Path,
  argPatch: z.record(z.string(), z.unknown()),
});
