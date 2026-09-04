import {
  FrameSchemeSchema,
  MAX_BOARD_NAME_LENGTH,
  type Node,
  NodeIdSchema,
  NodeSchema,
  SnippetParamSchema,
} from "@velloo/schema";
import { z } from "zod";
import {
  InnerPathSchema,
  jsonTolerant,
  type Locator,
  LocatorOrRootSchema,
  LocatorSchema,
  PatchRecordSchema,
} from "./locator.ts";

/**
 * One argument schema per mutation, shared by every surface that accepts one:
 * the canvas's HTTP routes, the MCP tools, and `batch`.
 *
 * Before this module each mutation was declared up to three times — an HTTP
 * body schema, an inline MCP `inputSchema`, and nothing at all for `batch`,
 * which dispatched raw `Record<string, unknown>` straight into the impls. The
 * copies drifted (MCP's `add_node` took `emitAs` and a `propPatch` alias that
 * the HTTP body did not), and the unvalidated third path was a documented
 * crash source. One declaration per mutation removes both failure modes.
 *
 * ## Shapes, bodies, and normalization
 *
 * Each mutation exports a **shape** (a `ZodRawShape`) rather than only a built
 * object schema, because the MCP SDK reflects over the shape to emit each
 * tool's JSON Schema. `<Name>Body` is `z.object(shape)` for surfaces that
 * validate a whole request body.
 *
 * Shapes stay free of `.transform()` for the same reason — a transformed
 * schema is a `ZodPipe`, whose shape the SDK cannot read, so tools would
 * advertise no parameters at all. Where a mutation accepts more than one
 * spelling of an argument, the reconciliation lives in an explicit
 * `normalize*` function instead, and `MUTATION_SPECS` pairs the two so no
 * caller can validate without also normalizing.
 *
 * Schemas here are deliberately the **most permissive form the impl actually
 * accepts** (tolerant locators, JSON-string-wrapped arrays, argument aliases).
 * Tolerance belongs in the shared declaration; a stricter surface silently
 * rejecting what its sibling accepts is the drift this module exists to end.
 */

/**
 * The outcome of reconciling validated input into an impl's argument shape.
 *
 * Normalization can fail where a schema cannot: "pass either the single form
 * or the bulk form" is a cross-field rule, and `children: "Save"` has to reach
 * a handler that answers with the `props.children` nudge rather than a generic
 * type error. Both surfaces render the same failure this way instead of each
 * writing its own wording.
 */
export type Normalized<T> =
  | { ok: true; args: T }
  | { ok: false; message: string; issues?: unknown };

const invalid = <T>(message: string, issues?: unknown): Normalized<T> =>
  issues === undefined ? { ok: false, message } : { ok: false, message, issues };

// ── Shared field fragments ─────────────────────────────────────────────

const ScreenId = z.string().min(1);
const BoardId = z.string().min(1);
const FrameId = z.string().min(1);
const SnippetId = z.string().min(1);

const FramePatchSchema = z.object({
  x: z.number().optional(),
  y: z.number().optional(),
  w: z.number().int().positive().optional(),
  h: z.number().int().positive().optional(),
  label: z.string().nullable().optional(),
  group: z.string().nullable().optional(),
  scheme: FrameSchemeSchema.nullable().optional(),
});

const EmitAsSchema = z
  .object({ name: z.string().min(1), importPath: z.string().min(1) })
  .describe(
    "Mark the node a host-component facade: the canvas renders the subtree, emit_code emits <name /> from importPath instead.",
  );

const AnnotationPositionSchema = z.union([
  z.object({ x: z.number(), y: z.number() }),
  z.literal("auto"),
]);

// ── Tree mutations ─────────────────────────────────────────────────────

export const addNodeShape = {
  screenId: ScreenId,
  parentPath: LocatorOrRootSchema,
  componentRef: z.string().min(1),
  id: NodeIdSchema.optional(),
  props: PatchRecordSchema.optional(),
  /** Accepted alias for `props`, so the key matches update_props. */
  propPatch: PatchRecordSchema.optional().describe("Alias for `props`."),
  children: jsonTolerant(z.union([z.array(NodeSchema), z.string(), z.number()])).optional(),
  index: z.number().int().nonnegative().optional(),
  emitAs: EmitAsSchema.optional(),
} satisfies z.ZodRawShape;
export const AddNodeBody = z.object(addNodeShape);
export type AddNodeInput = z.infer<typeof AddNodeBody>;

/**
 * Optional fields are `?: T | undefined` here and throughout: these shapes are
 * built from zod output, whose `.optional()` yields `T | undefined`, and they
 * describe arguments where an absent key and an undefined one mean the same
 * thing. `exactOptionalPropertyTypes` keeps that a stated choice rather than
 * an accident — the places that genuinely distinguish the two (prop patches,
 * where `null` removes and absent leaves alone) stay narrow.
 */
export interface AddNodeArgs {
  screenId: string;
  parentPath: Locator;
  componentRef: string;
  id?: string | undefined;
  props?: Record<string, unknown> | undefined;
  children?: Node[] | undefined;
  index?: number | undefined;
  emitAs?: { name: string; importPath: string } | undefined;
}

/**
 * `props` and `propPatch` are the same field under two names. A scalar
 * `children` ("just put the label here") is rejected with the array issue the
 * `props.children` nudge keys off, rather than silently dropped.
 */
export function normalizeAddNode(input: AddNodeInput): Normalized<AddNodeArgs> {
  const { propPatch, children, ...rest } = input;
  if (typeof children === "string" || typeof children === "number") {
    return invalid("add_node: `children` must be an array of nodes.", [
      { code: "invalid_type", expected: "array", path: ["children"] },
    ]);
  }
  const props = input.props ?? propPatch;
  return {
    ok: true,
    args: {
      ...rest,
      ...(props === undefined ? {} : { props }),
      ...(children === undefined ? {} : { children }),
    },
  };
}

/**
 * Single-node and bulk edits share one schema because agents conflate them.
 * `path`/`propPatch` describe one node; `patches` describes many.
 */
export const updatePropsShape = {
  screenId: ScreenId,
  path: LocatorSchema.optional(),
  propPatch: PatchRecordSchema.optional(),
  /** Accepted alias for `propPatch`, so the key matches add_node. */
  props: PatchRecordSchema.optional().describe("Alias for `propPatch`."),
  patches: jsonTolerant(
    z.array(z.object({ path: LocatorSchema, propPatch: PatchRecordSchema })).min(1),
  )
    .optional()
    .describe("Bulk mode — mutually exclusive with path/propPatch"),
} satisfies z.ZodRawShape;
export const UpdatePropsBody = z.object(updatePropsShape);
export type UpdatePropsInput = z.infer<typeof UpdatePropsBody>;

export interface UpdatePropsSingleArgs {
  screenId: string;
  path: Locator;
  propPatch: Record<string, unknown>;
}

export interface UpdatePropsBulkArgs {
  screenId: string;
  patches: Array<{ path: Locator; propPatch: Record<string, unknown> }>;
}

export type UpdatePropsPlan =
  | { mode: "single"; args: UpdatePropsSingleArgs }
  | { mode: "bulk"; args: UpdatePropsBulkArgs };

/**
 * Resolve which of the two forms was meant. Deliberately liberal: when a
 * single edit arrives *alongside* a bulk list, it is prepended to the list
 * rather than rejected — agents routinely send both.
 */
export function normalizeUpdateProps(input: UpdatePropsInput): Normalized<UpdatePropsPlan> {
  const propPatch = input.propPatch ?? input.props;
  if (input.patches) {
    const patches =
      input.path !== undefined && propPatch !== undefined
        ? [{ path: input.path, propPatch }, ...input.patches]
        : input.patches;
    return { ok: true, args: { mode: "bulk", args: { screenId: input.screenId, patches } } };
  }
  if (input.path === undefined || propPatch === undefined) {
    return invalid("update_props: path+propPatch required (or pass patches).");
  }
  return {
    ok: true,
    args: { mode: "single", args: { screenId: input.screenId, path: input.path, propPatch } },
  };
}

export const applyClassesShape = {
  screenId: ScreenId,
  path: LocatorOrRootSchema,
  classes: z.string(),
} satisfies z.ZodRawShape;
export const ApplyClassesBody = z.object(applyClassesShape);

export const setStyleShape = {
  screenId: ScreenId,
  path: LocatorSchema,
  style: jsonTolerant(z.union([z.string(), PatchRecordSchema, z.null()])).describe(
    "className string (Tailwind), a style object (sx / style channels), or null to clear",
  ),
} satisfies z.ZodRawShape;
export const SetStyleBody = z.object(setStyleShape);

export const removeNodeShape = {
  screenId: ScreenId,
  path: LocatorSchema,
} satisfies z.ZodRawShape;
export const RemoveNodeBody = z.object(removeNodeShape);

export const moveNodeShape = {
  screenId: ScreenId,
  fromPath: LocatorSchema,
  toParent: LocatorSchema,
  toIndex: z.number().int().nonnegative().optional(),
} satisfies z.ZodRawShape;
export const MoveNodeBody = z.object(moveNodeShape);

export const setNodeIdShape = {
  screenId: ScreenId,
  path: LocatorSchema,
  id: NodeIdSchema.nullable(),
} satisfies z.ZodRawShape;
export const SetNodeIdBody = z.object(setNodeIdShape);

export const overrideSnippetPropsShape = {
  screenId: ScreenId,
  path: LocatorSchema,
  innerPath: InnerPathSchema,
  propPatch: PatchRecordSchema,
} satisfies z.ZodRawShape;
export const OverrideSnippetPropsBody = z.object(overrideSnippetPropsShape);

// ── Screens ────────────────────────────────────────────────────────────

export const addScreenShape = {
  name: z.string().min(1),
  id: z.string().min(1).optional(),
  fromScreenId: z.string().min(1).optional(),
  tree: NodeSchema.optional(),
} satisfies z.ZodRawShape;
export const AddScreenBody = z.object(addScreenShape);

export const removeScreenShape = { screenId: ScreenId } satisfies z.ZodRawShape;
export const RemoveScreenBody = z.object(removeScreenShape);

export const setScreenTreeShape = {
  screenId: ScreenId,
  tree: NodeSchema,
} satisfies z.ZodRawShape;
export const SetScreenTreeBody = z.object(setScreenTreeShape);

export const updateScreenShape = {
  screenId: ScreenId,
  patch: z.object({ name: z.string().min(1).optional() }),
} satisfies z.ZodRawShape;
export const UpdateScreenBody = z.object(updateScreenShape);

// ── Boards ─────────────────────────────────────────────────────────────

export const addBoardShape = {
  name: z.string().min(1).max(MAX_BOARD_NAME_LENGTH),
  id: z.string().min(1).optional(),
  group: z.string().min(1).optional(),
} satisfies z.ZodRawShape;
export const AddBoardBody = z.object(addBoardShape);

export const updateBoardShape = {
  boardId: BoardId,
  patch: z.object({
    name: z.string().min(1).max(MAX_BOARD_NAME_LENGTH).optional(),
    theme: z.string().min(1).nullable().optional(),
    archived: z.boolean().optional(),
    group: z.string().min(1).nullable().optional(),
  }),
} satisfies z.ZodRawShape;
export const UpdateBoardBody = z.object(updateBoardShape);

export const removeBoardShape = { boardId: BoardId } satisfies z.ZodRawShape;
export const RemoveBoardBody = z.object(removeBoardShape);

export const reorderBoardsShape = {
  order: z.array(z.string().min(1)),
} satisfies z.ZodRawShape;
export const ReorderBoardsBody = z.object(reorderBoardsShape);

// ── Board groups (canvas-only — agents file boards via update_board) ────

export const addBoardGroupShape = {
  name: z.string().min(1),
  color: z.string().min(1).optional(),
} satisfies z.ZodRawShape;
export const AddBoardGroupBody = z.object(addBoardGroupShape);

export const updateBoardGroupShape = {
  groupId: z.string().min(1),
  patch: z.object({
    name: z.string().min(1).optional(),
    color: z.string().min(1).nullable().optional(),
  }),
} satisfies z.ZodRawShape;
export const UpdateBoardGroupBody = z.object(updateBoardGroupShape);

export const removeBoardGroupShape = {
  groupId: z.string().min(1),
} satisfies z.ZodRawShape;
export const RemoveBoardGroupBody = z.object(removeBoardGroupShape);

export const reorderBoardGroupsShape = {
  order: z.array(z.string().min(1)),
} satisfies z.ZodRawShape;
export const ReorderBoardGroupsBody = z.object(reorderBoardGroupsShape);

// ── Frames ─────────────────────────────────────────────────────────────

export const addFrameShape = {
  boardId: BoardId,
  screenId: ScreenId,
  x: z.number().optional(),
  y: z.number().optional(),
  w: z.number().int().positive(),
  h: z.number().int().positive(),
  label: z.string().optional(),
  group: z.string().optional(),
  id: z.string().min(1).optional(),
} satisfies z.ZodRawShape;
export const AddFrameBody = z.object(addFrameShape);

/** Single-or-bulk, on the same terms as `update_props`. */
export const updateFrameShape = {
  boardId: BoardId,
  frameId: FrameId.optional(),
  patch: FramePatchSchema.optional(),
  patches: jsonTolerant(z.array(z.object({ frameId: FrameId, patch: FramePatchSchema })).min(1))
    .optional()
    .describe("Bulk mode — mutually exclusive with frameId/patch"),
} satisfies z.ZodRawShape;
export const UpdateFrameBody = z.object(updateFrameShape);
export type UpdateFrameInput = z.infer<typeof UpdateFrameBody>;

export type FramePatchValue = z.infer<typeof FramePatchSchema>;

export interface UpdateFrameSingleArgs {
  boardId: string;
  frameId: string;
  patch: FramePatchValue;
}

export interface UpdateFramesArgs {
  boardId: string;
  patches: Array<{ frameId: string; patch: FramePatchValue }>;
}

export type UpdateFramePlan =
  | { mode: "single"; args: UpdateFrameSingleArgs }
  | { mode: "bulk"; args: UpdateFramesArgs };

/** Same liberal reconciliation as `normalizeUpdateProps`. */
export function normalizeUpdateFrame(input: UpdateFrameInput): Normalized<UpdateFramePlan> {
  if (input.patches) {
    const patches =
      input.frameId !== undefined && input.patch !== undefined
        ? [{ frameId: input.frameId, patch: input.patch }, ...input.patches]
        : input.patches;
    return { ok: true, args: { mode: "bulk", args: { boardId: input.boardId, patches } } };
  }
  if (input.frameId === undefined || input.patch === undefined) {
    return invalid("update_frame: frameId+patch required (or pass patches).");
  }
  return {
    ok: true,
    args: {
      mode: "single",
      args: { boardId: input.boardId, frameId: input.frameId, patch: input.patch },
    },
  };
}

export const removeFrameShape = {
  boardId: BoardId,
  frameId: FrameId,
} satisfies z.ZodRawShape;
export const RemoveFrameBody = z.object(removeFrameShape);

// ── Snippets ───────────────────────────────────────────────────────────

export const addSnippetShape = {
  name: z.string().min(1),
  id: z.string().min(1).optional(),
  params: z.array(SnippetParamSchema).default([]),
  tree: NodeSchema,
} satisfies z.ZodRawShape;
export const AddSnippetBody = z.object(addSnippetShape);

export const updateSnippetShape = {
  snippetId: SnippetId,
  patch: z.object({
    name: z.string().min(1).optional(),
    params: z.array(SnippetParamSchema).optional(),
    tree: NodeSchema.optional(),
    innerPatch: z.object({ innerPath: InnerPathSchema, propPatch: PatchRecordSchema }).optional(),
  }),
} satisfies z.ZodRawShape;
export const UpdateSnippetBody = z.object(updateSnippetShape);

export const removeSnippetShape = { snippetId: SnippetId } satisfies z.ZodRawShape;
export const RemoveSnippetBody = z.object(removeSnippetShape);

export const instantiateSnippetShape = {
  screenId: ScreenId,
  parentPath: LocatorOrRootSchema,
  snippetId: SnippetId,
  id: NodeIdSchema.optional(),
  args: PatchRecordSchema.optional(),
  extraClassName: z.string().optional(),
  overrides: z.record(z.string(), z.object({ props: PatchRecordSchema })).optional(),
  index: z.number().int().nonnegative().optional(),
} satisfies z.ZodRawShape;
export const InstantiateSnippetBody = z.object(instantiateSnippetShape);

export const updateSnippetArgsShape = {
  screenId: ScreenId,
  path: LocatorSchema,
  argPatch: PatchRecordSchema.default({}),
  extraClassName: z.string().nullable().optional(),
} satisfies z.ZodRawShape;
export const UpdateSnippetArgsBody = z.object(updateSnippetArgsShape);

// ── Annotations + board notes ──────────────────────────────────────────

export const addAnnotationShape = {
  screenId: ScreenId,
  target: z.object({ locator: LocatorSchema }),
  body: z.string(),
  position: AnnotationPositionSchema.optional(),
  collapsed: z.boolean().optional(),
} satisfies z.ZodRawShape;
export const AddAnnotationBody = z.object(addAnnotationShape);

export const updateAnnotationShape = {
  screenId: ScreenId,
  annotationId: z.string().min(1),
  patch: z.object({
    body: z.string().optional(),
    position: AnnotationPositionSchema.optional(),
    collapsed: z.boolean().nullable().optional(),
  }),
} satisfies z.ZodRawShape;
export const UpdateAnnotationBody = z.object(updateAnnotationShape);

export const removeAnnotationShape = {
  screenId: ScreenId,
  annotationId: z.string().min(1),
} satisfies z.ZodRawShape;
export const RemoveAnnotationBody = z.object(removeAnnotationShape);

/** Node a note is about. `frameId` picks which frame of the screen hosts it. */
export const NoteAttachmentSchema = z.object({
  frameId: FrameId,
  screenId: ScreenId,
  locator: LocatorSchema,
});

export const addNoteShape = {
  boardId: BoardId,
  /** Required for a free note; an attached note is auto-placed until dragged. */
  x: z.number().optional(),
  y: z.number().optional(),
  width: z.number().positive().optional(),
  body: z.string(),
  attachment: NoteAttachmentSchema.optional(),
} satisfies z.ZodRawShape;
export const AddNoteBody = z
  .object(addNoteShape)
  .refine((a) => a.attachment !== undefined || (a.x !== undefined && a.y !== undefined), {
    message: "A note without an attachment needs x and y",
    path: ["x"],
  });

export const updateNoteShape = {
  boardId: BoardId,
  noteId: z.string().min(1),
  patch: z.object({
    x: z.number().optional(),
    y: z.number().optional(),
    width: z.number().positive().optional(),
    body: z.string().optional(),
  }),
} satisfies z.ZodRawShape;
export const UpdateNoteBody = z.object(updateNoteShape);

export const removeNoteShape = {
  boardId: BoardId,
  noteId: z.string().min(1),
} satisfies z.ZodRawShape;
export const RemoveNoteBody = z.object(removeNoteShape);

// ── Folder config ──────────────────────────────────────────────────────

export const updateViewportPresetsShape = {
  presets: z.array(
    z.object({
      name: z.string().min(1),
      w: z.number().int().positive(),
      h: z.number().int().positive(),
    }),
  ),
} satisfies z.ZodRawShape;
export const UpdateViewportPresetsBody = z.object(updateViewportPresetsShape);

/**
 * `null` clears the default, an absent key leaves it alone — so the dialog can
 * write one picker without echoing the other back.
 */
export const updateDefaultsShape = {
  defaultBoard: z.string().min(1).nullable().optional(),
  defaultScreen: z.string().min(1).nullable().optional(),
} satisfies z.ZodRawShape;
export const UpdateDefaultsBody = z.object(updateDefaultsShape);

export const updateCodegenShape = {
  componentsAlias: z.string().nullable().optional(),
} satisfies z.ZodRawShape;
export const UpdateCodegenBody = z.object(updateCodegenShape);

export const updateFeedbackShape = {
  enabled: z.boolean().optional(),
  contactOk: z.boolean().optional(),
} satisfies z.ZodRawShape;
export const UpdateFeedbackBody = z.object(updateFeedbackShape);
