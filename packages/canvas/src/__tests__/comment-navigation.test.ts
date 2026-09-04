import { describe, expect, test } from "bun:test";
import type { CommentThreadView } from "@velloo/schema";
import { iframeRectToBoard } from "../board-geometry.ts";
import { commentNumbers } from "../comment-order.ts";

function thread(id: string, createdAt: string): CommentThreadView {
  return {
    id,
    scope: "local",
    folderId: "folder",
    boardId: "main",
    anchorState: { status: "board" },
    origin: { kind: "local" },
    status: "open",
    messages: [
      {
        id: crypto.randomUUID(),
        author: { kind: "user" },
        body: id,
        createdAt,
      },
    ],
    createdAt,
    updatedAt: createdAt,
  };
}

describe("comment navigation presentation", () => {
  test("numbers comments chronologically even when the newest thread is listed first", () => {
    const first = thread("11111111-1111-4111-8111-111111111111", "2026-08-28T10:00:00.000Z");
    const second = thread("22222222-2222-4222-8222-222222222222", "2026-08-28T10:01:00.000Z");
    const numbers = commentNumbers([second, first]);

    expect(numbers.get(first.id)).toBe(1);
    expect(numbers.get(second.id)).toBe(2);
  });

  test("translates a freshly measured iframe rect from the anchored frame coordinate space", () => {
    expect(
      iframeRectToBoard(
        { x: 500, y: 300, w: 390, h: 844 },
        { x: 0, y: 32 },
        { x: -12, y: 620, w: 120, h: 40 },
      ),
    ).toEqual({ x: 500, y: 952, w: 120, h: 40 });
  });
});
