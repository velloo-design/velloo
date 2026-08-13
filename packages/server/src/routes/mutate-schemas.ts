import { NodeIdSchema, NodeSchema, SnippetParamSchema } from "@velloo/schema";
import { z } from "zod";

const Path = z.array(z.number().int().nonnegative());

/**
 * A node locator: either a path array (e.g. `[1, 2, 0]`) or an `@id`
 * reference (e.g. `"@hero-cta"`). The id form is resolved against the
 * variant tree at mutation time and is stable across sibling
 * insertions and deletions.
 */
const IdLocator = z.string().regex(/^@[a-zA-Z][a-zA-Z0-9_-]*$/, {
  message: "id locator must match /^@[a-zA-Z][a-zA-Z0-9_-]*$/",
});
const Locator = z.union([Path, IdLocator]);
/** Locator that defaults to root (`[]`) when the field is missing entirely. */
const LocatorOrRoot = Locator.default([] as number[] | string);
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
  parentPath: LocatorOrRoot,
  componentRef: z.string().min(1),
  id: NodeIdSchema.optional(),
  props: z.record(z.string(), z.unknown()).optional(),
  children: z.array(NodeSchema).optional(),
  index: z.number().int().nonnegative().optional(),
});

export const UpdatePropsBody = z.object({
  pageId: z.string().min(1),
  variantId: z.string().min(1),
  path: LocatorOrRoot,
  propPatch: z.record(z.string(), z.unknown()),
});

export const RemoveNodeBody = z.object({
  pageId: z.string().min(1),
  variantId: z.string().min(1),
  path: LocatorOrRoot,
});

export const MoveNodeBody = z.object({
  pageId: z.string().min(1),
  variantId: z.string().min(1),
  fromPath: Locator,
  toParent: Locator,
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
  path: LocatorOrRoot,
  classes: z.string(),
});

export const UpdatePropsBulkBody = z.object({
  pageId: z.string().min(1),
  variantId: z.string().min(1),
  patches: z
    .array(
      z.object({
        path: Locator,
        propPatch: z.record(z.string(), z.unknown()),
      }),
    )
    .min(1),
});

export const ApplyClassesBulkBody = z.object({
  pageId: z.string().min(1),
  variantId: z.string().min(1),
  patches: z
    .array(
      z.object({
        path: Locator,
        classes: z.string(),
      }),
    )
    .min(1),
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
  parentPath: LocatorOrRoot,
  snippetId: z.string().min(1),
  id: NodeIdSchema.optional(),
  args: z.record(z.string(), z.unknown()).optional(),
  extraClassName: z.string().optional(),
  index: z.number().int().nonnegative().optional(),
});

export const UpdateSnippetArgsBody = z.object({
  pageId: z.string().min(1),
  variantId: z.string().min(1),
  path: Locator,
  argPatch: z.record(z.string(), z.unknown()).default({}),
  extraClassName: z.string().nullable().optional(),
});

export const SetNodeIdBody = z.object({
  pageId: z.string().min(1),
  variantId: z.string().min(1),
  path: Locator,
  /** New id, or null to clear. */
  id: NodeIdSchema.nullable(),
});

// --- Annotations + canvas notes ----------------------------------------

const AnnotationPositionSchema = z.union([
  z.object({ x: z.number(), y: z.number() }),
  z.literal("auto"),
]);

export const AddAnnotationBody = z.object({
  pageId: z.string().min(1),
  target: z.object({
    variantId: z.string().min(1),
    locator: Locator,
  }),
  body: z.string(),
  position: AnnotationPositionSchema.optional(),
  collapsed: z.boolean().optional(),
});

export const UpdateAnnotationBody = z.object({
  pageId: z.string().min(1),
  annotationId: z.string().min(1),
  patch: z.object({
    body: z.string().optional(),
    position: AnnotationPositionSchema.optional(),
    /** null clears the persisted collapsed state. */
    collapsed: z.boolean().nullable().optional(),
  }),
});

export const RemoveAnnotationBody = z.object({
  pageId: z.string().min(1),
  annotationId: z.string().min(1),
});

export const AddNoteBody = z.object({
  pageId: z.string().min(1),
  x: z.number(),
  y: z.number(),
  width: z.number().positive().optional(),
  body: z.string(),
});

export const UpdateNoteBody = z.object({
  pageId: z.string().min(1),
  noteId: z.string().min(1),
  patch: z.object({
    x: z.number().optional(),
    y: z.number().optional(),
    width: z.number().positive().optional(),
    body: z.string().optional(),
  }),
});

export const RemoveNoteBody = z.object({
  pageId: z.string().min(1),
  noteId: z.string().min(1),
});
