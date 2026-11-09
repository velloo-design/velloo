import { expect, test } from "bun:test";
import type { CommentThreadView } from "@velloo/schema";
import { domSuite, mount, text } from "./dom.ts";

/**
 * A comment whose author's account was deleted keeps the name it was written
 * under — the cloud says so with `accountDeleted` — and reads as a name that no
 * longer belongs to anyone: greyed, labelled, and never anyone's own.
 */

const { ThreadMessages, ThreadPreview, canvasVoiceFor, canvasCanDeleteFor } = await import(
  "../components/comment-threads.tsx"
);

type Message = CommentThreadView["messages"][number];

const ACCOUNT = "acct-1";

function message(author: Message["author"], id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"): Message {
  return { id, author, body: "Tighten this", createdAt: new Date().toISOString() };
}

const departed = message({
  kind: "reviewer",
  displayName: "Ada",
  accountId: ACCOUNT,
  role: "member",
  accountDeleted: true,
});
const present = message({ kind: "reviewer", displayName: "Grace", role: "member" });

function thread(first: Message): CommentThreadView {
  const now = new Date().toISOString();
  return {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    scope: "shared",
    folderId: "folder",
    boardId: "board",
    origin: { kind: "published", slug: "s", versionId: "v" },
    status: "open",
    messages: [first],
    createdAt: now,
    updatedAt: now,
    anchorState: { status: "board" },
  };
}

domSuite("a deleted account's comments", () => {
  test("the name stays, greyed and labelled", async () => {
    const view = await mount(<ThreadMessages messages={[departed]} />);
    const name = view.host.querySelector<HTMLElement>("[data-author-deleted]");
    expect(text(name)).toBe("Ada");
    expect(name?.className).toContain("text-muted-foreground");
    expect(name?.title).toBe("This account was deleted");
    expect(text(view.host.querySelector('[data-slot="message-header"]'))).toContain(
      "Deleted account",
    );
    await view.unmount();
  });

  test("anyone else's name is drawn as before", async () => {
    const view = await mount(<ThreadMessages messages={[present]} />);
    expect(view.host.querySelector("[data-author-deleted]")).toBeNull();
    const header = view.host.querySelector('[data-slot="message-header"]');
    expect(text(header)).toContain("Grace");
    expect(text(header)).not.toContain("Deleted account");
    expect(header?.querySelector("span")?.className).not.toContain("text-muted-foreground");
    await view.unmount();
  });

  test("the preview greys the thread's starter", async () => {
    const view = await mount(<ThreadPreview thread={thread(departed)} />);
    const name = view.host.querySelector<HTMLElement>("[data-author-deleted]");
    expect(text(name)).toBe("Ada");
    expect(name?.className).toContain("text-muted-foreground");
    expect(name?.classList.contains("text-foreground")).toBe(false);
    expect(text(view.host.querySelector("[data-comment-preview]"))).toContain("Deleted account");
    await view.unmount();

    const live = await mount(<ThreadPreview thread={thread(present)} />);
    expect(live.host.querySelector("[data-author-deleted]")).toBeNull();
    await live.unmount();
  });
});

test("a deleted account is nobody's own voice and nobody's to take back", () => {
  const voice = canvasVoiceFor(ACCOUNT)(departed);
  expect(voice).toEqual({ align: "start", variant: "outline" });
  expect(canvasCanDeleteFor(ACCOUNT)(departed)).toBe(false);

  const asUser = message({ kind: "user", displayName: "Ada", accountDeleted: true });
  expect(canvasVoiceFor(undefined)(asUser).align).toBe("start");
  expect(canvasCanDeleteFor(undefined)(asUser)).toBe(false);
});
