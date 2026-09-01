import {
  MAX_BOARD_NAME_LENGTH,
  NodeIdSchema,
  NodeSchema,
  SnippetParamSchema,
} from "@velloo/schema";
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

export const ApplyClassesBody = z.object({
  screenId: z.string().min(1),
  path: LocatorOrRoot,
  classes: z.string(),
});

export const SetNodeIdBody = z.object({
  screenId: z.string().min(1),
  path: Locator,
  id: NodeIdSchema.nullable(),
});

// ── Board lifecycle ────────────────────────────────────────────────────
export const AddBoardBody = z.object({
  name: z.string().min(1).max(MAX_BOARD_NAME_LENGTH),
  id: z.string().min(1).optional(),
});
export const UpdateBoardBody = z.object({
  boardId: z.string().min(1),
  patch: z.object({
    name: z.string().min(1).max(MAX_BOARD_NAME_LENGTH).optional(),
    theme: z.string().min(1).nullable().optional(),
    archived: z.boolean().optional(),
  }),
});
export const RemoveBoardBody = z.object({
  boardId: z.string().min(1),
});
export const ReorderBoardsBody = z.object({
  order: z.array(z.string().min(1)),
});

// ── Frame lifecycle ────────────────────────────────────────────────────
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

export const RemoveFrameBody = z.object({
  boardId: z.string().min(1),
  frameId: z.string().min(1),
});

// ── Snippets ───────────────────────────────────────────────────────────
export const UpdateSnippetBody = z.object({
  snippetId: z.string().min(1),
  patch: z.object({
    name: z.string().min(1).optional(),
    params: z.array(SnippetParamSchema).optional(),
    tree: NodeSchema.optional(),
  }),
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
