import { z } from "zod";

/**
 * Two annotation primitives, deliberately split:
 *
 *  - **CanvasNote**: free-positioned markdown in board coordinate space.
 *    Pure designer scratchpad. Lives in `board.notes.json` at the folder
 *    root. Not exposed to the agent.
 *
 *  - **Annotation**: tied to a specific node in a Screen via `locator`.
 *    The screen id is implied by the sidecar filename
 *    (`screens/<screenId>.annotations.json`). Canvas draws a dashed
 *    connector between the annotation pill and the targeted node's
 *    bounding box across every Frame that shows that screen. Exposed
 *    read-only to the agent so designer commentary flows into the agent's
 *    context naturally.
 *
 * Both formats use markdown for `body` (a small subset: headers, bold,
 * italic, line breaks, emoji as literal unicode). Stored verbatim;
 * canvas renders, agent reads as-is.
 */

/**
 * Locator value embedded in an annotation target. Mirrors the server's
 * `Locator` union but the schema package can't depend on server code so
 * the validation is repeated here.
 */
const AnnotationLocatorSchema = z.union([
  z.array(z.number().int().nonnegative()),
  z.string().regex(/^@[a-zA-Z][a-zA-Z0-9_-]*$/),
]);

export const AnnotationTargetSchema = z.object({
  /** Path array or `"@id"` string identifying the anchored node within a screen tree. */
  locator: AnnotationLocatorSchema,
});
export type AnnotationTarget = z.infer<typeof AnnotationTargetSchema>;

const PositionSchema = z.union([z.object({ x: z.number(), y: z.number() }), z.literal("auto")]);

export const AnnotationSchema = z.object({
  id: z.string().min(1),
  target: AnnotationTargetSchema,
  /**
   * Canvas placement. `"auto"` lets the canvas position it to the left of
   * the anchored node's bounding box; an explicit `{x, y}` is set when the
   * user drags the annotation to override.
   */
  position: PositionSchema.default("auto"),
  /** Markdown body. */
  body: z.string(),
  /** Persisted collapsed state. Optional — undefined means "use canvas default". */
  collapsed: z.boolean().optional(),
  /**
   * Who wrote it. Absent = "user" (pre-existing annotations predate the
   * field). Agents may create annotations (questions pinned to a node,
   * review remarks) but may only edit/remove their own — user-authored
   * annotations remain the protected designer→agent channel.
   */
  author: z.enum(["user", "agent"]).optional(),
  /**
   * Provenance for an annotation pulled from a velloo-cloud share-link
   * comment (the `pull_comments` sync). `commentId` keys idempotent
   * re-pulls — a cloud comment lands as at most one annotation, on any
   * machine that syncs this folder. `slug` names the share link it came
   * from; `author` is the commenter's display name. Locally authored
   * annotations never carry this field.
   */
  cloud: z
    .object({
      commentId: z.string().min(1),
      slug: z.string().min(1),
      author: z.string().optional(),
    })
    .optional(),
});
export type Annotation = z.infer<typeof AnnotationSchema>;

export const CanvasNoteSchema = z.object({
  id: z.string().min(1),
  x: z.number(),
  y: z.number(),
  /**
   * User-resizable width. Height is always derived from content (notes
   * never scroll; the box expands downward).
   */
  width: z.number().positive(),
  /** Markdown body. */
  body: z.string(),
});
export type CanvasNote = z.infer<typeof CanvasNoteSchema>;
