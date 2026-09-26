import { expect, test } from "bun:test";
import { $, domSuite, mount, text } from "./dom.ts";

/**
 * The sidebar's per-board comment badges. Cloud and local stay two badges —
 * a reviewer waiting on an answer is not a note to self — and a board with
 * nothing open shows nothing at all rather than a zero.
 */

const { BoardCommentBadges, openCommentsLabel } = await import(
  "../components/BoardsSidebar/BoardCommentBadges.tsx"
);

test("labels each count with its scope and plural", () => {
  expect(openCommentsLabel(3, "shared")).toBe("3 open cloud comments");
  expect(openCommentsLabel(1, "local")).toBe("1 open local comment");
});

domSuite("board comment badges", () => {
  test("shows a cloud and a local badge, each with its own tooltip", async () => {
    const view = await mount(
      <BoardCommentBadges counts={{ shared: 3, local: 1 }} active={false} />,
    );
    const cloud = $("[data-testid='board-comments-shared']");
    const local = $("[data-testid='board-comments-local']");
    expect(cloud?.getAttribute("title")).toBe("3 open cloud comments");
    expect(local?.getAttribute("title")).toBe("1 open local comment");
    expect(text(cloud)).toContain("3");
    expect(text(local)).toContain("1");
    await view.unmount();
  });

  test("leaves out a scope with nothing open", async () => {
    const view = await mount(
      <BoardCommentBadges counts={{ shared: 2, local: 0 }} active={false} />,
    );
    expect($("[data-testid='board-comments-shared']")).not.toBeNull();
    expect($("[data-testid='board-comments-local']")).toBeNull();
    await view.unmount();
  });

  test("renders nothing for a board without open comments", async () => {
    const view = await mount(
      <span data-testid="host">
        <BoardCommentBadges counts={undefined} active={false} />
        <BoardCommentBadges counts={{ shared: 0, local: 0 }} active />
      </span>,
    );
    expect($("[data-testid='host']")?.children.length).toBe(0);
    await view.unmount();
  });
});
