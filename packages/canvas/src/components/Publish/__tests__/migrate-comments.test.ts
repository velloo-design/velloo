import { describe, expect, test } from "bun:test";
import type { CommentThreadView } from "@velloo/schema";
import { commentsElsewhere } from "../MigrateComments.tsx";

const thread = (
  id: string,
  slug: string,
  over: Partial<CommentThreadView> = {},
): CommentThreadView => ({
  id,
  scope: "shared",
  folderId: "folder",
  boardId: "main",
  origin: { kind: "published", slug, versionId: "v1" },
  status: "open",
  messages: [
    { id: `${id}-m`, author: { kind: "user" }, body: "x", createdAt: "2026-10-02T10:00:00.000Z" },
  ],
  createdAt: "2026-10-02T10:00:00.000Z",
  updatedAt: "2026-10-02T10:00:00.000Z",
  anchorState: { status: "board" },
  ...over,
});

describe("commentsElsewhere", () => {
  test("groups open cloud threads by the link they live on, leaving the destination's alone", () => {
    expect(
      commentsElsewhere(
        [
          thread("a", "old", { branch: "feature/old" }),
          thread("b", "old", { branch: "feature/old" }),
          thread("c", "here"),
          thread("d", "other"),
        ],
        "here",
      ),
    ).toEqual([
      { slug: "old", branch: "feature/old", threadIds: ["a", "b"] },
      { slug: "other", branch: null, threadIds: ["d"] },
    ]);
  });

  test("offers nothing the cloud would refuse to move", () => {
    const resolved = thread("r", "old", { status: "resolved" });
    const readOnly = thread("m", "old", { manage: false });
    const local: CommentThreadView = {
      ...thread("l", "old"),
      scope: "local",
      origin: { kind: "local" },
    };
    expect(commentsElsewhere([resolved, readOnly, local], null)).toEqual([]);
  });
});
