import { z } from "zod";
import { ResourceIdSchema } from "./ids.ts";

export const CommentLocatorSchema = z.union([
  z.array(z.number().int().nonnegative()),
  z.string().regex(/^@[a-zA-Z][a-zA-Z0-9_-]*$/),
]);
export type CommentLocator = z.infer<typeof CommentLocatorSchema>;

export const CommentBoundsSchema = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number().nonnegative(),
  h: z.number().nonnegative(),
});
export type CommentBounds = z.infer<typeof CommentBoundsSchema>;

export const CommentNodeFingerprintSchema = z.object({
  ref: z.string().min(1).optional(),
  text: z.string().max(500).optional(),
  ancestorIds: z.array(z.string().min(1)).max(16).optional(),
});
export type CommentNodeFingerprint = z.infer<typeof CommentNodeFingerprintSchema>;

/**
 * A folder-relative image path ("assets/sketchbook/…") — what the Look or
 * sketchbook file records, so the canvas and a share both find the image.
 */
const CommentImagePathSchema = z
  .string()
  .min(1)
  .max(500)
  .regex(/^assets\/[^?#\\]+$/)
  .refine((path) => !path.split("/").includes(".."));

/**
 * A node or board anchor names the board it was authored on. Node anchors
 * additionally retain the exact frame + screen + locator and rendered bounds
 * the author saw. The locator is authoritative only for the origin design
 * state; bounds and fingerprint preserve honest context when it goes stale.
 * A Look anchor (by theme name) and a sketchbook anchor are on no board.
 */
export const CommentAnchorSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("node"),
    boardId: ResourceIdSchema,
    frameId: ResourceIdSchema,
    screenId: ResourceIdSchema,
    locator: CommentLocatorSchema,
    bounds: CommentBoundsSchema,
    fingerprint: CommentNodeFingerprintSchema.optional(),
  }),
  z.object({
    kind: z.literal("board"),
    boardId: ResourceIdSchema,
    x: z.number(),
    y: z.number(),
  }),
  z.object({
    kind: z.literal("look"),
    look: z.string().min(1).max(200),
    image: CommentImagePathSchema.optional(),
  }),
  z.object({
    kind: z.literal("sketchbook"),
    sketchbook: z.string().min(1).max(200),
    direction: z.string().min(1).max(200).optional(),
    image: CommentImagePathSchema.optional(),
  }),
]);
export type CommentAnchor = z.infer<typeof CommentAnchorSchema>;

/**
 * The author's role in the board's organization when the cloud served the
 * thread — "guest" for someone invited to (or reading) a link without a seat.
 * Distinct from `kind`: a `reviewer` is anyone who wrote through the share
 * page, the link's owner included.
 */
const CommentAuthorRoleSchema = z.enum(["owner", "admin", "member", "reviewer", "guest"]);
export type CommentAuthorRole = z.infer<typeof CommentAuthorRoleSchema>;

export const CommentAuthorSchema = z.object({
  kind: z.enum(["user", "agent", "reviewer"]),
  displayName: z.string().min(1).max(200).optional(),
  accountId: z.string().min(1).max(200).optional(),
  role: CommentAuthorRoleSchema.optional(),
  /** The cloud's word that this author published the board. Never set on an agent's message. */
  publisher: z.boolean().optional(),
  /**
   * The cloud's word that the account behind this name was deleted; its words
   * stay under the name they were written with.
   */
  accountDeleted: z.boolean().optional(),
});
export type CommentAuthor = z.infer<typeof CommentAuthorSchema>;

export const CommentMessageSchema = z
  .object({
    id: z.uuid(),
    author: CommentAuthorSchema,
    /** Empty only on a tombstone — taking a message back erases what it said. */
    body: z.string().trim().max(4000),
    createdAt: z.iso.datetime(),
    /**
     * When the author took this message back. The message stays in the thread
     * so the conversation still reads in order and replies keep their
     * antecedent; only the body goes.
     */
    deletedAt: z.iso.datetime().optional(),
  })
  .refine((message) => message.deletedAt !== undefined || message.body.length > 0, {
    message: "A comment needs something to say",
    path: ["body"],
  });
export type CommentMessage = z.infer<typeof CommentMessageSchema>;

export const CommentOriginSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("local") }),
  z.object({
    kind: z.literal("published"),
    slug: z.string().min(1),
    versionId: z.string().min(1),
  }),
]);
export type CommentOrigin = z.infer<typeof CommentOriginSchema>;

/** The anchors that put a thread on no board. */
export type OffBoardAnchor = Extract<CommentAnchor, { kind: "look" | "sketchbook" }>;
export const isOffBoardAnchor = (anchor: CommentAnchor | undefined): anchor is OffBoardAnchor =>
  anchor?.kind === "look" || anchor?.kind === "sketchbook";

/** An off-board anchor in words: `Look "Night", image assets/…`. */
export function offBoardPlace(anchor: OffBoardAnchor): string {
  const image = anchor.image !== undefined ? `, image ${anchor.image}` : "";
  if (anchor.kind === "look") return `Look "${anchor.look}"${image}`;
  const direction = anchor.direction !== undefined ? `, direction ${anchor.direction}` : "";
  return `sketchbook ${anchor.sketchbook}${direction}${image}`;
}

export const CommentThreadSchema = z
  .object({
    id: z.uuid(),
    scope: z.enum(["local", "shared"]),
    folderId: z.string().min(1),
    /** Absent exactly when the anchor is a Look or a sketchbook. */
    boardId: ResourceIdSchema.optional(),
    anchor: CommentAnchorSchema.optional(),
    origin: CommentOriginSchema,
    status: z.enum(["open", "resolved"]),
    messages: z.array(CommentMessageSchema).min(1),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    resolvedAt: z.iso.datetime().optional(),
  })
  .refine((thread) => isOffBoardAnchor(thread.anchor) || thread.boardId !== undefined, {
    message: "A thread on a board names its board",
    path: ["boardId"],
  });
export type CommentThread = z.infer<typeof CommentThreadSchema>;

export type CommentAnchorState =
  | { status: "board" }
  /** A Look or sketchbook anchor whose Look, sketchbook or image is still there. */
  | { status: "off-board" }
  | { status: "attached"; resolvedPath: number[] }
  | { status: "stale" };

export type CommentThreadView = CommentThread & {
  anchorState: CommentAnchorState;
  /**
   * False when the viewer can read the thread but not resolve or delete it — a
   * cloud thread on a link they no longer manage. Absent means they can.
   */
  manage?: false;
  /** The git branch a cloud thread's link was last published from, where known. */
  branch?: string;
};
