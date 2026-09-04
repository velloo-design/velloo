import type { CommentThreadView } from "@velloo/schema";

/** Stable chronological pin numbers, independent of list/update ordering. */
export function commentNumbers(threads: CommentThreadView[]): Map<string, number> {
  return new Map(
    [...threads]
      .sort((left, right) => {
        const byCreated = left.createdAt.localeCompare(right.createdAt);
        return byCreated !== 0 ? byCreated : left.id.localeCompare(right.id);
      })
      .map((thread, index) => [thread.id, index + 1]),
  );
}
