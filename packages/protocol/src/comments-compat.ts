import type { CommentThread } from "@velloo/schema";
import type { PublishedCommentThread } from "./comments.ts";

/**
 * Compile-time proof that everything velloo-cloud serves is a thread velloo
 * can ingest — that `PublishedCommentThread` stays a *projection* of
 * `CommentThread` rather than a fork of it. If either side drifts, this stops
 * compiling.
 *
 * It lives apart from `comments.ts` so that module can stay zod-only: the
 * cloud carries the wire declarations into a container with no velloo
 * checkout, and this check is velloo's side of the contract, not the cloud's.
 */
export type PublishedThreadIsIngestible = PublishedCommentThread extends CommentThread
  ? true
  : never;

const publishedThreadIsIngestible: PublishedThreadIsIngestible = true;
void publishedThreadIsIngestible;
