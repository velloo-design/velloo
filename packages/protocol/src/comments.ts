import { z } from "zod";

/**
 * The published-comment wire contract, shared with velloo-cloud.
 *
 * A reviewer comments on a published share link; the cloud stores the thread
 * and velloo's daemon pulls it back into the design folder. Both ends were
 * describing that payload separately — velloo in `@velloo/schema`'s
 * `CommentThread`, the cloud in its own `src/comments.ts` — with no compiler
 * anywhere checking that the two agreed.
 *
 * This module is the one declaration. It depends on **nothing but zod** —
 * deliberately, because velloo-cloud's server runs unbundled from a container
 * that has no velloo checkout, so this file is carried into the image on its
 * own. The compile-time proof that these shapes are ingestible by velloo lives
 * in `comments-compat.ts`, which is not part of what the cloud carries.
 *
 * ## Why the ids are looser here than in a design folder
 *
 * Folder-side ids are `ResourceIdSchema` (max 64, no dots — filename stems
 * double as ids). The published wire form intentionally stays at the cloud's
 * historical bound instead: these rows predate the folder-side rule, and a
 * refactor must not start rejecting comments already in the database. The
 * constraint that matters here is length-bounding untrusted input, which this
 * does.
 */

const PUBLISHED_ID_MAX = 200;
const PublishedId = z.string().min(1).max(PUBLISHED_ID_MAX);

export const PublishedCommentBoundsSchema = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number().nonnegative(),
  h: z.number().nonnegative(),
});
export type PublishedCommentBounds = z.infer<typeof PublishedCommentBoundsSchema>;

/**
 * Honest context for an anchor whose locator has gone stale — what the node
 * was when the reviewer pointed at it.
 */
export const PublishedCommentFingerprintSchema = z.object({
  ref: z.string().min(1).optional(),
  text: z.string().max(500).optional(),
  ancestorIds: z.array(z.string().min(1)).max(16).optional(),
});
export type PublishedCommentFingerprint = z.infer<typeof PublishedCommentFingerprintSchema>;

/**
 * Where a published comment points. A node anchor retains the exact frame +
 * screen + locator and rendered bounds the reviewer saw; the locator is
 * authoritative only for the design state it was authored against.
 */
export const PublishedCommentAnchorSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("node"),
    boardId: PublishedId,
    frameId: PublishedId,
    screenId: PublishedId,
    locator: z.union([
      z.array(z.number().int().nonnegative()).max(64),
      z.string().regex(/^@[a-zA-Z][a-zA-Z0-9_-]*$/),
    ]),
    bounds: PublishedCommentBoundsSchema,
    fingerprint: PublishedCommentFingerprintSchema.optional(),
  }),
  z.object({
    kind: z.literal("board"),
    boardId: PublishedId,
    x: z.number(),
    y: z.number(),
  }),
]);
export type PublishedCommentAnchor = z.infer<typeof PublishedCommentAnchorSchema>;

/**
 * Who wrote a published message. Three parties reach one thread and the
 * reader has to be able to tell them apart:
 *
 *  - `reviewer` — someone commenting through the share link;
 *  - `user` — the designer who owns the link, writing from their canvas;
 *  - `agent` — an agent writing through that designer's daemon.
 *
 * The last two authenticate identically (both are the owner's account), so
 * the distinction can only come from the caller declaring it — see
 * `authorKind` on the write bodies below.
 */
export const PublishedCommentAuthorSchema = z.object({
  kind: z.enum(["reviewer", "user", "agent"]),
  displayName: z.string().min(1).max(200),
  accountId: z.string().min(1).max(200).optional(),
});
export type PublishedCommentAuthor = z.infer<typeof PublishedCommentAuthorSchema>;

/**
 * Which of the two owner-side voices is writing. Only the account that
 * manages the link may claim either; a reviewer's messages are stamped
 * `reviewer` by the endpoint and never by the body.
 */
export const OwnerAuthorKindSchema = z.enum(["user", "agent"]);
export type OwnerAuthorKind = z.infer<typeof OwnerAuthorKindSchema>;

export const PublishedCommentMessageSchema = z
  .object({
    id: z.uuid(),
    author: PublishedCommentAuthorSchema,
    /** Empty only on a tombstone — see `deletedAt`. */
    body: z.string().trim().max(4000),
    createdAt: z.iso.datetime(),
    /** When its author took it back; the row stays, the body doesn't. */
    deletedAt: z.iso.datetime().optional(),
  })
  .refine((message) => message.deletedAt !== undefined || message.body.length > 0, {
    message: "A comment needs something to say",
    path: ["body"],
  });
export type PublishedCommentMessage = z.infer<typeof PublishedCommentMessageSchema>;

/**
 * A thread as the cloud serves it. This is the `scope: "shared"` /
 * `origin.kind: "published"` projection of velloo's `CommentThread` — the
 * assignability check in `comments-compat.ts` is what keeps it a projection
 * rather than a fork.
 */
export const PublishedCommentThreadSchema = z.object({
  id: z.uuid(),
  scope: z.literal("shared"),
  folderId: z.string().min(1),
  boardId: PublishedId,
  anchor: PublishedCommentAnchorSchema.optional(),
  origin: z.object({
    kind: z.literal("published"),
    slug: z.string().min(1),
    versionId: z.string().min(1),
  }),
  status: z.enum(["open", "resolved"]),
  messages: z.array(PublishedCommentMessageSchema).min(1),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  resolvedAt: z.iso.datetime().optional(),
});
export type PublishedCommentThread = z.infer<typeof PublishedCommentThreadSchema>;

/** `GET /v1/links/:slug/comment-threads` and the owner feed. */
export const PublishedCommentsResponseSchema = z.object({
  threads: z.array(PublishedCommentThreadSchema),
  links: z.record(z.string(), z.enum(["ok", "revoked"])).optional(),
  now: z.iso.datetime().optional(),
});
export type PublishedCommentsResponse = z.infer<typeof PublishedCommentsResponseSchema>;

/** Bodies the published-comment write endpoints accept. */
export const CreateCommentThreadBodySchema = z
  .object({
    versionId: z.uuid(),
    boardId: PublishedId,
    anchor: PublishedCommentAnchorSchema.optional(),
    body: z.string().trim().min(1).max(4000),
    authorKind: OwnerAuthorKindSchema.optional(),
  })
  .refine((value) => !value.anchor || value.anchor.boardId === value.boardId, {
    message: "the anchor belongs to a different board",
  });
export type CreateCommentThreadBody = z.infer<typeof CreateCommentThreadBodySchema>;

export const ReplyCommentBodySchema = z.object({
  body: z.string().trim().min(1).max(4000),
  authorKind: OwnerAuthorKindSchema.optional(),
});
export type ReplyCommentBody = z.infer<typeof ReplyCommentBodySchema>;

export const ResolveCommentBodySchema = z.object({ resolved: z.boolean() });
export type ResolveCommentBody = z.infer<typeof ResolveCommentBodySchema>;
