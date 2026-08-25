import { NodeIdSchema, NodeSchema, SnippetParamSchema } from "@velloo/schema";
import { z } from "zod";

const Path = z.array(z.number().int().nonnegative());
const IdLocator = z.string().regex(/^@[a-zA-Z][a-zA-Z0-9_-]*$/, {
  message: "id locator must match /^@[a-zA-Z][a-zA-Z0-9_-]*$/",
});
const Locator = z.union([Path, IdLocator]);
const LocatorOrRoot = Locator.default([] as number[] | string);

const FramePatch = z.object({
  x: z.number().optional(),
  y: z.number().optional(),
  w: z.number().int().positive().optional(),
  h: z.number().int().positive().optional(),
  label: z.string().nullable().optional(),
  group: z.string().nullable().optional(),
});

// ── Tree mutations ─────────────────────────────────────────────────────
export const AddNodeBody = z.object({
  screenId: z.string().min(1),
  parentPath: LocatorOrRoot,
  componentRef: z.string().min(1),
  id: NodeIdSchema.optional(),
  props: z.record(z.string(), z.unknown()).optional(),
  children: z.array(NodeSchema).optional(),
  index: z.number().int().nonnegative().optional(),
});

export const UpdatePropsBody = z.object({
  screenId: z.string().min(1),
  path: LocatorOrRoot,
  propPatch: z.record(z.string(), z.unknown()),
});

export const RemoveNodeBody = z.object({
  screenId: z.string().min(1),
  path: LocatorOrRoot,
});

export const MoveNodeBody = z.object({
  screenId: z.string().min(1),
  fromPath: Locator,
  toParent: Locator,
  toIndex: z.number().int().nonnegative().optional(),
});

export const ApplyClassesBody = z.object({
  screenId: z.string().min(1),
  path: LocatorOrRoot,
  classes: z.string(),
});

export const UpdatePropsBulkBody = z.object({
  screenId: z.string().min(1),
  patches: z
    .array(z.object({ path: Locator, propPatch: z.record(z.string(), z.unknown()) }))
    .min(1),
});

export const ApplyClassesBulkBody = z.object({
  screenId: z.string().min(1),
  patches: z.array(z.object({ path: Locator, classes: z.string() })).min(1),
});

export const SetNodeIdBody = z.object({
  screenId: z.string().min(1),
  path: Locator,
  id: NodeIdSchema.nullable(),
});

// ── Screen lifecycle ───────────────────────────────────────────────────
export const AddScreenBody = z.object({
  name: z.string().min(1),
  id: z.string().min(1).optional(),
  fromScreenId: z.string().min(1).optional(),
  tree: NodeSchema.optional(),
});

export const RemoveScreenBody = z.object({
  screenId: z.string().min(1),
});

export const UpdateScreenBody = z.object({
  screenId: z.string().min(1),
  patch: z.object({ name: z.string().min(1).optional() }),
});

// ── Board lifecycle ────────────────────────────────────────────────────
export const AddBoardBody = z.object({
  name: z.string().min(1),
  id: z.string().min(1).optional(),
});
export const UpdateBoardBody = z.object({
  boardId: z.string().min(1),
  // Mirrors the MCP update_board schema: theme pins a named theme for the
  // board's frames; null clears back to the folder default.
  patch: z.object({
    name: z.string().min(1).optional(),
    theme: z.string().min(1).nullable().optional(),
  }),
});
export const RemoveBoardBody = z.object({
  boardId: z.string().min(1),
});
export const ReorderBoardsBody = z.object({
  order: z.array(z.string().min(1)),
});

// ── Frame / group lifecycle ────────────────────────────────────────────
export const AddFrameBody = z.object({
  boardId: z.string().min(1),
  screenId: z.string().min(1),
  x: z.number().optional(),
  y: z.number().optional(),
  w: z.number().int().positive(),
  h: z.number().int().positive(),
  label: z.string().optional(),
  group: z.string().optional(),
  id: z.string().min(1).optional(),
});

export const UpdateFrameBody = z.object({
  boardId: z.string().min(1),
  frameId: z.string().min(1),
  patch: FramePatch,
});

export const UpdateFramesBody = z.object({
  boardId: z.string().min(1),
  patches: z.array(z.object({ frameId: z.string().min(1), patch: FramePatch })).min(1),
});

export const RemoveFrameBody = z.object({
  boardId: z.string().min(1),
  frameId: z.string().min(1),
});

export const AddGroupBody = z.object({
  boardId: z.string().min(1),
  name: z.string().min(1),
  color: z.string().optional(),
  id: z.string().min(1).optional(),
});

export const UpdateGroupBody = z.object({
  boardId: z.string().min(1),
  groupId: z.string().min(1),
  patch: z.object({
    name: z.string().min(1).optional(),
    color: z.string().nullable().optional(),
  }),
});

export const RemoveGroupBody = z.object({
  boardId: z.string().min(1),
  groupId: z.string().min(1),
});

// ── Snippets ───────────────────────────────────────────────────────────
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
  screenId: z.string().min(1),
  parentPath: LocatorOrRoot,
  snippetId: z.string().min(1),
  id: NodeIdSchema.optional(),
  args: z.record(z.string(), z.unknown()).optional(),
  extraClassName: z.string().optional(),
  index: z.number().int().nonnegative().optional(),
});

export const UpdateSnippetArgsBody = z.object({
  screenId: z.string().min(1),
  path: Locator,
  argPatch: z.record(z.string(), z.unknown()).default({}),
  extraClassName: z.string().nullable().optional(),
});

// ── Annotations + board notes ──────────────────────────────────────────
const AnnotationPositionSchema = z.union([
  z.object({ x: z.number(), y: z.number() }),
  z.literal("auto"),
]);

export const AddAnnotationBody = z.object({
  screenId: z.string().min(1),
  target: z.object({ locator: Locator }),
  body: z.string(),
  position: AnnotationPositionSchema.optional(),
  collapsed: z.boolean().optional(),
});

export const UpdateAnnotationBody = z.object({
  screenId: z.string().min(1),
  annotationId: z.string().min(1),
  patch: z.object({
    body: z.string().optional(),
    position: AnnotationPositionSchema.optional(),
    collapsed: z.boolean().nullable().optional(),
  }),
});

export const RemoveAnnotationBody = z.object({
  screenId: z.string().min(1),
  annotationId: z.string().min(1),
});

export const AddNoteBody = z.object({
  boardId: z.string().min(1),
  x: z.number(),
  y: z.number(),
  width: z.number().positive().optional(),
  body: z.string(),
});

export const UpdateNoteBody = z.object({
  boardId: z.string().min(1),
  noteId: z.string().min(1),
  patch: z.object({
    x: z.number().optional(),
    y: z.number().optional(),
    width: z.number().positive().optional(),
    body: z.string().optional(),
  }),
});

export const RemoveNoteBody = z.object({
  boardId: z.string().min(1),
  noteId: z.string().min(1),
});
