import { describe, expect, test } from "bun:test";
import type { CommentThreadView } from "@velloo/schema";
import { renderToStaticMarkup } from "react-dom/server";
import { cloudUnavailableHint } from "../../api.ts";
import {
  CommentScopeFilterToggle,
  CommentTargetToggle,
  LOCAL_COMMENT_SCOPE_HELP,
} from "../CommentScopeControls.tsx";
import { MOVE_TO_CLOUD_HELP } from "../CommentsPanel.tsx";
import { CommentThreadListItem, ThreadMessages } from "../comment-threads.tsx";

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

  /**
   * An unpublished board is the one blocker posting clears by itself, so the
   * cloud target stays pickable and is marked rather than disabled — the whole
   * point of dropping the separate Publish button.
   */
  test("marks the cloud target as needing a publish instead of closing it", () => {
    const html = renderToStaticMarkup(
      <CommentTargetToggle
        scope="shared"
        onChange={() => undefined}
        cloud={{ available: false, reason: "unpublished" }}
      />,
    );
    expect(html).not.toContain('disabled=""');
    expect(html).toContain("data-needs-publish");
    expect(html).toContain("Posting opens the publish flow first");
    expect(html).not.toContain(">Publish<");
  });

  test("closes the cloud target, with a sign-in, when the account is the blocker", () => {
    const html = renderToStaticMarkup(
      <CommentTargetToggle
        scope="local"
        onChange={() => undefined}
        cloud={{ available: false, reason: "signed-out" }}
      />,
    );
    expect(html).toContain('disabled=""');
    expect(html).toContain("Sign in to velloo cloud");
    expect(html).toContain("Sign in to write cloud comments");
    expect(html).not.toContain("data-needs-publish");
  });

  test("enables the cloud target once the board is published", () => {
    const html = renderToStaticMarkup(
      <CommentTargetToggle
        scope="shared"
        onChange={() => undefined}
        cloud={{ available: true, slug: "review", url: "https://review.velloo.dev/" }}
      />,
    );
    expect(html).toContain("Post to the published board at https://review.velloo.dev/");
    expect(html).not.toContain('disabled=""');
    expect(html).not.toContain("data-needs-publish");
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

  /**
   * The cloud stamps the account's name on every owner-side message, and the
   * designer and their agent share that account — so on the canvas the name
   * can't tell them apart, and the voice has to.
   */
  test("names the owner's voices on a cloud thread rather than their shared account", () => {
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
            author: { kind: "user", displayName: "Rodrigo Silveira" },
            body: "On it",
            createdAt: "2026-08-28T10:01:00.000Z",
          },
          {
            id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            author: { kind: "agent", displayName: "Rodrigo Silveira" },
            body: "Rewritten",
            createdAt: "2026-08-28T10:02:00.000Z",
          },
        ]}
      />,
    );
    expect(html).toContain("jane.reviewer");
    expect(html).toContain("You");
    expect(html).toContain("Agent");
    expect(html).not.toContain("Rodrigo Silveira");
  });

  /**
   * The three voices have to stay visually distinct, and the distinction is
   * carried entirely by data attributes the bubble variants key off — so a
   * wrong variant is invisible in a content assertion but obvious here.
   */
  test("gives each voice its own side and surface", () => {
    const messageOf = (author: CommentThreadView["messages"][number]["author"]) =>
      renderToStaticMarkup(
        <ThreadMessages
          messages={[
            {
              id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
              author,
              body: "x",
              createdAt: thread.createdAt,
            },
          ]}
        />,
      );

    // Yours reads as sent: right-aligned, filled.
    const own = messageOf({ kind: "user" });
    expect(own).toContain('data-align="end"');
    expect(own).toContain('data-variant="default"');

    // The agent answers on the other side, muted.
    const agent = messageOf({ kind: "agent" });
    expect(agent).toContain('data-align="start"');
    expect(agent).toContain('data-variant="muted"');

    // A reviewer is outlined — they are speaking from off this machine.
    const reviewer = messageOf({ kind: "reviewer" });
    expect(reviewer).toContain('data-align="start"');
    expect(reviewer).toContain('data-variant="outline"');
  });

  test("a message taken back leaves a tombstone and no body", () => {
    const html = renderToStaticMarkup(
      <ThreadMessages
        onDelete={() => undefined}
        messages={[
          {
            id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            author: { kind: "user" },
            body: "",
            createdAt: "2026-08-28T10:00:00.000Z",
            deletedAt: "2026-08-28T10:05:00.000Z",
          },
          {
            id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            author: { kind: "user" },
            body: "What I actually meant",
            createdAt: "2026-08-28T10:06:00.000Z",
          },
        ]}
      />,
    );
    expect(html).toContain("Comment deleted");
    expect(html).toContain('data-variant="ghost"');
    expect(html).toContain("What I actually meant");
    // One delete control, on the message that still has something to delete.
    expect(html.match(/aria-label="Delete this comment"/g)).toHaveLength(1);
  });

  test("offers no delete on a reviewer's message — it isn't this account's", () => {
    const html = renderToStaticMarkup(
      <ThreadMessages
        onDelete={() => undefined}
        messages={[
          {
            id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            author: { kind: "reviewer", displayName: "jane.reviewer" },
            body: "Make this headline more direct",
            createdAt: "2026-08-28T10:00:00.000Z",
          },
        ]}
      />,
    );
    expect(html).not.toContain('aria-label="Delete this comment"');
  });

  test("a thread whose opening message went shows the next one, not a blank row", () => {
    const row = renderToStaticMarkup(
      <CommentThreadListItem
        thread={{
          ...thread,
          messages: [
            {
              ...(thread.messages[0] as CommentThreadView["messages"][number]),
              body: "",
              deletedAt: "2026-08-28T10:05:00.000Z",
            },
            {
              id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
              author: { kind: "user" },
              body: "What I actually meant",
              createdAt: "2026-08-28T10:06:00.000Z",
            },
          ],
        }}
        number={1}
        onOpen={() => undefined}
        onLocate={() => undefined}
      />,
    );
    expect(row).toContain("What I actually meant");
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
    expect(row).toContain("Local");
    expect(row).toContain("Pinned comment");
    expect(row).toContain('aria-label="Go to comment 1"');
  });

  test("counts a row's replies rather than its messages", () => {
    const row = renderToStaticMarkup(
      <CommentThreadListItem
        thread={{
          ...thread,
          messages: [
            ...thread.messages,
            {
              id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
              author: { kind: "agent" },
              body: "Done",
              createdAt: "2026-08-28T10:06:00.000Z",
            },
          ],
        }}
        number={1}
        onOpen={() => undefined}
        onLocate={() => undefined}
      />,
    );
    expect(row).toContain(">1</span>");
    expect(row).not.toContain("2 messages");
  });

  /**
   * The row's delete is destructive and unlabelled, so the control's identity
   * has to survive in the markup — and a cloud thread must not offer one at
   * all: the daemon refuses to erase a conversation other people have read.
   */
  test("offers delete on a local row and none on a cloud row", () => {
    const local = renderToStaticMarkup(
      <CommentThreadListItem
        thread={thread}
        number={2}
        onOpen={() => undefined}
        onLocate={() => undefined}
        onDelete={() => undefined}
      />,
    );
    expect(local).toContain('aria-label="Delete thread 2"');

    const cloud = renderToStaticMarkup(
      <CommentThreadListItem
        thread={{ ...thread, scope: "shared" }}
        number={2}
        onOpen={() => undefined}
        onLocate={() => undefined}
      />,
    );
    expect(cloud).not.toContain("Delete thread");
  });

  test("marks a resolved row and a row whose target moved", () => {
    const resolved = renderToStaticMarkup(
      <CommentThreadListItem
        thread={{ ...thread, status: "resolved" }}
        number={1}
        onOpen={() => undefined}
        onLocate={() => undefined}
      />,
    );
    expect(resolved).toContain("Resolved");

    const stale = renderToStaticMarkup(
      <CommentThreadListItem
        thread={{ ...thread, anchorState: { status: "stale" } }}
        number={1}
        onOpen={() => undefined}
        onLocate={() => undefined}
      />,
    );
    expect(stale).toContain("Target changed");
  });
});
