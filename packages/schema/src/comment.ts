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
 * A comment anchor always names the board it was authored on. Node anchors
 * additionally retain the exact frame + screen + locator and rendered bounds
 * the author saw. The locator is authoritative only for the origin design
 * state; bounds and fingerprint preserve honest context when it goes stale.
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
]);
export type CommentAnchor = z.infer<typeof CommentAnchorSchema>;

export const CommentAuthorSchema = z.object({
  kind: z.enum(["user", "agent", "reviewer"]),
  displayName: z.string().min(1).max(200).optional(),
  accountId: z.string().min(1).max(200).optional(),
});
export type CommentAuthor = z.infer<typeof CommentAuthorSchema>;

export const CommentMessageSchema = z.object({
  id: z.uuid(),
  author: CommentAuthorSchema,
  body: z.string().trim().min(1).max(4000),
  createdAt: z.iso.datetime(),
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

export const CommentThreadSchema = z.object({
  id: z.uuid(),
  scope: z.enum(["local", "shared"]),
  folderId: z.string().min(1),
  boardId: ResourceIdSchema,
  anchor: CommentAnchorSchema.optional(),
  origin: CommentOriginSchema,
  status: z.enum(["open", "resolved"]),
  messages: z.array(CommentMessageSchema).min(1),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  resolvedAt: z.iso.datetime().optional(),
  /** Set by an explicit canvas action; agents use it as their feedback inbox. */
  agentRequestedAt: z.iso.datetime().optional(),
});
export type CommentThread = z.infer<typeof CommentThreadSchema>;

export type CommentAnchorState =
  | { status: "board" }
  | { status: "attached"; resolvedPath: number[] }
  | { status: "stale" };

export type CommentThreadView = CommentThread & { anchorState: CommentAnchorState };
