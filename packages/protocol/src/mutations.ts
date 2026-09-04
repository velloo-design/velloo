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

/**
 * Every `*Body` is a `z.strictObject`, so an argument the schema doesn't
 * declare fails loudly with the valid keys rather than being dropped.
 *
 * This used to differ by surface: the MCP layer rewrapped each raw shape as
 * `strictObject` at registration, while `Body` — the form `batch` and the HTTP
 * routes parse — was a plain `z.object`. The same typo was a hard error
 * standalone and a silent no-op inside a batch, which is the harder failure to
 * notice: a 40-call batch returned green with one node unstyled.
 */
export const addNodeShape = {
  screenId: ScreenId,
  parentPath: LocatorOrRootSchema,
  componentRef: z.string().min(1),
  id: NodeIdSchema.optional(),
  props: PatchRecordSchema.optional(),
  children: jsonTolerant(z.union([z.array(NodeSchema), z.string(), z.number()])).optional(),
  index: z.number().int().nonnegative().optional(),
  emitAs: EmitAsSchema.optional(),
} satisfies z.ZodRawShape;
export const AddNodeBody = z.strictObject(addNodeShape);
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
 * A scalar `children` ("just put the label here") is rejected with the array
 * issue the `props.children` nudge keys off, rather than silently dropped.
 */
export function normalizeAddNode(input: AddNodeInput): Normalized<AddNodeArgs> {
  const { children, ...rest } = input;
  if (typeof children === "string" || typeof children === "number") {
    return invalid("add_node: `children` must be an array of nodes.", [
      { code: "invalid_type", expected: "array", path: ["children"] },
    ]);
  }
  const props = input.props;
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
export const StylePayloadSchema = jsonTolerant(
  z.union([z.string(), PatchRecordSchema, z.null()]),
).describe(
  "Native style channel: a className string (Tailwind), an object of properties (sx / style), or null to clear",
);

export const PropsPatchEntrySchema = z
  .object({
    path: LocatorSchema,
    propPatch: PatchRecordSchema.optional(),
    style: StylePayloadSchema.optional(),
  })
  .refine((e) => e.propPatch !== undefined || e.style !== undefined, {
    message: "each patch needs propPatch, style, or both",
  });

/**
 * One node per entry, many entries per call — a single write, one lock, one
 * broadcast. Deliberately has no single-node shorthand: the previous
 * `path`+`propPatch` OR `patches` pair declared five optional fields where two
 * combinations were legal, so the real contract lived in prose and a runtime
 * check rather than in the schema.
 */
export const updatePropsShape = {
  screenId: ScreenId,
  patches: jsonTolerant(z.array(PropsPatchEntrySchema).min(1)).describe(
    "One entry per node; length 1 for a single edit",
  ),
} satisfies z.ZodRawShape;
export const UpdatePropsBody = z.strictObject(updatePropsShape);
export type UpdatePropsInput = z.infer<typeof UpdatePropsBody>;

export type StylePayloadInput = z.infer<typeof StylePayloadSchema>;

export interface UpdatePropsArgs {
  screenId: string;
  patches: Array<{
    path: Locator;
    propPatch?: Record<string, unknown> | undefined;
    style?: StylePayloadInput | undefined;
  }>;
}

export const applyClassesShape = {
  screenId: ScreenId,
  path: LocatorOrRootSchema,
  classes: z.string(),
} satisfies z.ZodRawShape;
export const ApplyClassesBody = z.strictObject(applyClassesShape);

export const removeNodeShape = {
  screenId: ScreenId,
  path: LocatorSchema,
} satisfies z.ZodRawShape;
export const RemoveNodeBody = z.strictObject(removeNodeShape);

export const moveNodeShape = {
  screenId: ScreenId,
  fromPath: LocatorSchema,
  toParent: LocatorSchema,
  toIndex: z.number().int().nonnegative().optional(),
} satisfies z.ZodRawShape;
export const MoveNodeBody = z.strictObject(moveNodeShape);

export const setNodeIdShape = {
  screenId: ScreenId,
  path: LocatorSchema,
  id: NodeIdSchema.nullable(),
} satisfies z.ZodRawShape;
export const SetNodeIdBody = z.strictObject(setNodeIdShape);

// ── Screens ────────────────────────────────────────────────────────────

export const addScreenShape = {
  name: z.string().min(1),
  id: z.string().min(1).optional(),
  fromScreenId: z.string().min(1).optional(),
  tree: NodeSchema.optional(),
} satisfies z.ZodRawShape;
export const AddScreenBody = z.strictObject(addScreenShape);

export const removeScreenShape = { screenId: ScreenId } satisfies z.ZodRawShape;
export const RemoveScreenBody = z.strictObject(removeScreenShape);

export const setScreenTreeShape = {
  screenId: ScreenId,
  tree: NodeSchema,
} satisfies z.ZodRawShape;
export const SetScreenTreeBody = z.strictObject(setScreenTreeShape);

export const updateScreenShape = {
  screenId: ScreenId,
  patch: z.object({ name: z.string().min(1).optional() }),
} satisfies z.ZodRawShape;
export const UpdateScreenBody = z.strictObject(updateScreenShape);

// ── Boards ─────────────────────────────────────────────────────────────

export const addBoardShape = {
  name: z.string().min(1).max(MAX_BOARD_NAME_LENGTH),
  id: z.string().min(1).optional(),
  group: z.string().min(1).optional(),
} satisfies z.ZodRawShape;
export const AddBoardBody = z.strictObject(addBoardShape);

export const updateBoardShape = {
  boardId: BoardId,
  patch: z.object({
    name: z.string().min(1).max(MAX_BOARD_NAME_LENGTH).optional(),
    theme: z.string().min(1).nullable().optional(),
    archived: z.boolean().optional(),
    group: z.string().min(1).nullable().optional(),
  }),
} satisfies z.ZodRawShape;
export const UpdateBoardBody = z.strictObject(updateBoardShape);

export const removeBoardShape = { boardId: BoardId } satisfies z.ZodRawShape;
export const RemoveBoardBody = z.strictObject(removeBoardShape);

export const reorderBoardsShape = {
  order: z.array(z.string().min(1)),
} satisfies z.ZodRawShape;
export const ReorderBoardsBody = z.strictObject(reorderBoardsShape);

// ── Board groups (canvas-only — agents file boards via update_board) ────

export const addBoardGroupShape = {
  name: z.string().min(1),
  color: z.string().min(1).optional(),
} satisfies z.ZodRawShape;
export const AddBoardGroupBody = z.strictObject(addBoardGroupShape);

export const updateBoardGroupShape = {
  groupId: z.string().min(1),
  patch: z.object({
    name: z.string().min(1).optional(),
    color: z.string().min(1).nullable().optional(),
  }),
} satisfies z.ZodRawShape;
export const UpdateBoardGroupBody = z.strictObject(updateBoardGroupShape);

export const removeBoardGroupShape = {
  groupId: z.string().min(1),
} satisfies z.ZodRawShape;
export const RemoveBoardGroupBody = z.strictObject(removeBoardGroupShape);

export const reorderBoardGroupsShape = {
  order: z.array(z.string().min(1)),
} satisfies z.ZodRawShape;
export const ReorderBoardGroupsBody = z.strictObject(reorderBoardGroupsShape);

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
export const AddFrameBody = z.strictObject(addFrameShape);

/** Single-or-bulk, on the same terms as `update_props`. */
export const updateFrameShape = {
  boardId: BoardId,
  patches: jsonTolerant(
    z.array(z.object({ frameId: FrameId, patch: FramePatchSchema })).min(1),
  ).describe("One entry per frame; length 1 for a single edit"),
} satisfies z.ZodRawShape;
export const UpdateFrameBody = z.strictObject(updateFrameShape);
export type UpdateFrameInput = z.infer<typeof UpdateFrameBody>;

export type FramePatchValue = z.infer<typeof FramePatchSchema>;

export interface UpdateFramesArgs {
  boardId: string;
  patches: Array<{ frameId: string; patch: FramePatchValue }>;
}

export const removeFrameShape = {
  boardId: BoardId,
  frameId: FrameId,
} satisfies z.ZodRawShape;
export const RemoveFrameBody = z.strictObject(removeFrameShape);

// ── Snippets ───────────────────────────────────────────────────────────

export const addSnippetShape = {
  name: z.string().min(1),
  id: z.string().min(1).optional(),
  params: z.array(SnippetParamSchema).default([]),
  tree: NodeSchema,
} satisfies z.ZodRawShape;
export const AddSnippetBody = z.strictObject(addSnippetShape);

export const updateSnippetShape = {
  snippetId: SnippetId,
  patch: z.object({
    name: z.string().min(1).optional(),
    params: z.array(SnippetParamSchema).optional(),
    tree: NodeSchema.optional(),
    innerPatch: z.object({ innerPath: InnerPathSchema, propPatch: PatchRecordSchema }).optional(),
  }),
} satisfies z.ZodRawShape;
export const UpdateSnippetBody = z.strictObject(updateSnippetShape);

export const removeSnippetShape = { snippetId: SnippetId } satisfies z.ZodRawShape;
export const RemoveSnippetBody = z.strictObject(removeSnippetShape);

export const instantiateSnippetShape = {
  screenId: ScreenId,
  parentPath: LocatorOrRootSchema,
  snippetId: SnippetId,
  id: NodeIdSchema.optional(),
  args: PatchRecordSchema.optional(),
  extraClassName: z
    .string()
    .optional()
    .describe("One-off classes layered onto the snippet body's root, for this instance"),
  overrides: z.record(z.string(), z.object({ props: PatchRecordSchema })).optional(),
  index: z.number().int().nonnegative().optional(),
} satisfies z.ZodRawShape;
export const InstantiateSnippetBody = z.strictObject(instantiateSnippetShape);

export const overrideSnippetPropsShape = {
  screenId: ScreenId,
  path: LocatorSchema,
  innerPath: InnerPathSchema,
  propPatch: PatchRecordSchema,
} satisfies z.ZodRawShape;
export const OverrideSnippetPropsBody = z.strictObject(overrideSnippetPropsShape);

export const updateSnippetArgsShape = {
  screenId: ScreenId,
  path: LocatorSchema,
  argPatch: PatchRecordSchema.default({}),
  extraClassName: z.string().nullable().optional(),
} satisfies z.ZodRawShape;
export const UpdateSnippetArgsBody = z.strictObject(updateSnippetArgsShape);

/**
 * One instance of a snippet, edited from either side: `argPatch` /
 * `extraClassName` change what the caller passes in, `innerPath` + `propPatch`
 * patch a node inside that one instance's rendered body. They compose, so a
 * single call can retune an instance's inputs and its one-off override.
 */
export const updateSnippetInstanceShape = {
  screenId: ScreenId,
  path: LocatorSchema,
  argPatch: PatchRecordSchema.optional(),
  extraClassName: z.string().nullable().optional(),
  innerPath: InnerPathSchema.optional(),
  propPatch: PatchRecordSchema.optional(),
} satisfies z.ZodRawShape;
export const UpdateSnippetInstanceBody = z.strictObject(updateSnippetInstanceShape);
export type UpdateSnippetInstanceInput = z.infer<typeof UpdateSnippetInstanceBody>;

export interface UpdateSnippetInstancePlan {
  args?:
    | {
        screenId: string;
        path: Locator;
        argPatch: Record<string, unknown>;
        extraClassName?: string | null | undefined;
      }
    | undefined;
  override?:
    | { screenId: string; path: Locator; innerPath: string; propPatch: Record<string, unknown> }
    | undefined;
}

/** Split one instance edit into the arg-side and override-side calls it implies. */
export function normalizeUpdateSnippetInstance(
  input: UpdateSnippetInstanceInput,
): Normalized<UpdateSnippetInstancePlan> {
  const wantsArgs = input.argPatch !== undefined || input.extraClassName !== undefined;
  const hasInner = input.innerPath !== undefined;
  const hasPatch = input.propPatch !== undefined;
  if (hasInner !== hasPatch) {
    return invalid("update_snippet_instance: innerPath and propPatch go together.");
  }
  if (!wantsArgs && !hasInner) {
    return invalid(
      "update_snippet_instance: pass argPatch, extraClassName, or innerPath+propPatch.",
    );
  }
  const plan: UpdateSnippetInstancePlan = {};
  if (wantsArgs) {
    plan.args = {
      screenId: input.screenId,
      path: input.path,
      argPatch: input.argPatch ?? {},
      ...(input.extraClassName !== undefined ? { extraClassName: input.extraClassName } : {}),
    };
  }
  if (hasInner && input.innerPath !== undefined && input.propPatch !== undefined) {
    plan.override = {
      screenId: input.screenId,
      path: input.path,
      innerPath: input.innerPath,
      propPatch: input.propPatch,
    };
  }
  return { ok: true, args: plan };
}

// ── Annotations + board notes ──────────────────────────────────────────

export const addAnnotationShape = {
  screenId: ScreenId,
  target: z.object({ locator: LocatorSchema }),
  body: z.string(),
  position: AnnotationPositionSchema.optional(),
  collapsed: z.boolean().optional(),
} satisfies z.ZodRawShape;
export const AddAnnotationBody = z.strictObject(addAnnotationShape);

export const updateAnnotationShape = {
  screenId: ScreenId,
  annotationId: z.string().min(1),
  patch: z.object({
    body: z.string().optional(),
    position: AnnotationPositionSchema.optional(),
    collapsed: z.boolean().nullable().optional(),
  }),
} satisfies z.ZodRawShape;
export const UpdateAnnotationBody = z.strictObject(updateAnnotationShape);

export const removeAnnotationShape = {
  screenId: ScreenId,
  annotationId: z.string().min(1),
} satisfies z.ZodRawShape;
export const RemoveAnnotationBody = z.strictObject(removeAnnotationShape);

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
export const UpdateNoteBody = z.strictObject(updateNoteShape);

export const removeNoteShape = {
  boardId: BoardId,
  noteId: z.string().min(1),
} satisfies z.ZodRawShape;
export const RemoveNoteBody = z.strictObject(removeNoteShape);

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
export const UpdateViewportPresetsBody = z.strictObject(updateViewportPresetsShape);

/**
 * `null` clears the default, an absent key leaves it alone — so the dialog can
 * write one picker without echoing the other back.
 */
export const updateDefaultsShape = {
  defaultBoard: z.string().min(1).nullable().optional(),
  defaultScreen: z.string().min(1).nullable().optional(),
} satisfies z.ZodRawShape;
export const UpdateDefaultsBody = z.strictObject(updateDefaultsShape);

export const updateCodegenShape = {
  componentsAlias: z.string().nullable().optional(),
} satisfies z.ZodRawShape;
export const UpdateCodegenBody = z.strictObject(updateCodegenShape);

export const updateFeedbackShape = {
  enabled: z.boolean().optional(),
  contactOk: z.boolean().optional(),
} satisfies z.ZodRawShape;
export const UpdateFeedbackBody = z.strictObject(updateFeedbackShape);
