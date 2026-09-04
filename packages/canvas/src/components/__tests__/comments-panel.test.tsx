import { describe, expect, test } from "bun:test";
import type { CommentThreadView } from "@velloo/schema";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CommentScopeFilterToggle,
  CommentTargetPicker,
  cloudUnavailableHint,
  LOCAL_COMMENT_SCOPE_HELP,
} from "../CommentScopeControls.tsx";
import { CommentThreadListItem, MOVE_TO_CLOUD_HELP, ThreadMessages } from "../CommentsPanel.tsx";

const thread: CommentThreadView = {
  id: "11111111-1111-4111-8111-111111111111",
  scope: "local",
  folderId: "folder",
  boardId: "main",
  anchor: {
    kind: "node",
    boardId: "main",
    frameId: "home-frame",
    screenId: "home",
    locator: "@cta",
    bounds: { x: 10, y: 20, w: 100, h: 40 },
  },
  anchorState: { status: "attached", resolvedPath: [0] },
  origin: { kind: "local" },
  status: "open",
  messages: [
    {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      author: { kind: "user" },
      body: "Make this clearer",
      createdAt: "2026-08-28T10:00:00.000Z",
    },
  ],
  createdAt: "2026-08-28T10:00:00.000Z",
  updatedAt: "2026-08-28T10:00:00.000Z",
};

describe("comments panel affordances", () => {
  test("explains where each scope lives and what moving a thread costs", () => {
    expect(LOCAL_COMMENT_SCOPE_HELP).toContain("Local comments stay on this machine");
    expect(LOCAL_COMMENT_SCOPE_HELP).toContain("published board");
    expect(MOVE_TO_CLOUD_HELP).toContain("removes the local copy");
  });

  test("names the reason the cloud target is closed", () => {
    expect(cloudUnavailableHint("signed-out")).toContain("Sign in");
    expect(cloudUnavailableHint("unpublished")).toContain("Publish this board");
    expect(cloudUnavailableHint("unsupported")).toContain("cannot write cloud comments");
  });

  test("offers all three scopes in the filter", () => {
    const html = renderToStaticMarkup(
      <CommentScopeFilterToggle scope="all" onChange={() => undefined} />,
    );
    expect(html).toContain("All");
    expect(html).toContain("Local");
    expect(html).toContain("Cloud");
  });

  test("disables the cloud target and offers Publish when the board is unpublished", () => {
    const html = renderToStaticMarkup(
      <CommentTargetPicker
        scope="local"
        onChange={() => undefined}
        cloud={{ available: false, reason: "unpublished" }}
        onPublish={() => undefined}
      />,
    );
    expect(html).toContain('disabled=""');
    expect(html).toContain("Publish this board to write a cloud comment");
    expect(html).toContain(">Publish<");
  });

  test("disables the cloud target without a publish escape when signed out", () => {
    const html = renderToStaticMarkup(
      <CommentTargetPicker
        scope="local"
        onChange={() => undefined}
        cloud={{ available: false, reason: "signed-out" }}
        onPublish={() => undefined}
      />,
    );
    expect(html).toContain('disabled=""');
    expect(html).toContain("Sign in to velloo cloud");
    expect(html).not.toContain(">Publish<");
  });

  test("enables the cloud target once the board is published", () => {
    const html = renderToStaticMarkup(
      <CommentTargetPicker
        scope="shared"
        onChange={() => undefined}
        cloud={{ available: true, slug: "review", url: "https://review.velloo.dev/" }}
      />,
    );
    expect(html).toContain("Post to the published board at https://review.velloo.dev/");
    expect(html).not.toContain('disabled=""');
  });

  test("marks a reviewer's message as coming from outside the machine", () => {
    const html = renderToStaticMarkup(
      <ThreadMessages
        messages={[
          {
            id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            author: { kind: "reviewer", displayName: "jane.reviewer" },
            body: "Make this headline more direct",
            createdAt: "2026-08-28T10:00:00.000Z",
          },
          {
            id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            author: { kind: "user" },
            body: "On it",
            createdAt: "2026-08-28T10:01:00.000Z",
          },
          {
            id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            author: { kind: "agent" },
            body: "Rewritten",
            createdAt: "2026-08-28T10:02:00.000Z",
          },
        ]}
      />,
    );
    expect(html).toContain("jane.reviewer");
    expect(html).toContain(">Reviewer<");
    // A message with no name of its own falls back to naming its voice.
    expect(html).toContain("You");
    expect(html).toContain("Agent");
  });

  test("renders the thread-row scope label and Go to control", () => {
    const row = renderToStaticMarkup(
      <CommentThreadListItem
        thread={thread}
        number={1}
        onOpen={() => undefined}
        onLocate={() => undefined}
      />,
    );
    expect(row).toContain("#1");
    expect(row).toContain("Local");
    expect(row).toContain("Pinned comment");
    expect(row).toContain('aria-label="Go to comment 1"');
  });
});
