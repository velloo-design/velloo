import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { CommentAnchor, CommentThreadView } from "@velloo/schema";
import { useCanvas } from "../store.ts";

const realFetch = globalThis.fetch;
const now = "2026-08-28T10:00:00.000Z";
const threadId = "11111111-1111-4111-8111-111111111111";
const promotedId = "44444444-4444-4444-8444-444444444444";
const realLocateNode = useCanvas.getState().locateNode;
const realFlyToBoardRect = useCanvas.getState().flyToBoardRect;
const anchor: CommentAnchor = {
  kind: "node",
  boardId: "main",
  frameId: "home-frame",
  screenId: "home",
  locator: "@cta",
  bounds: { x: 10, y: 20, w: 100, h: 40 },
  fingerprint: { ref: "Button", text: "Start" },
};

let thread: CommentThreadView;
let requests: Array<{ method: string; path: string; body?: unknown }>;

const response = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

beforeEach(() => {
  requests = [];
  thread = {
    id: threadId,
    scope: "local",
    folderId: "folder",
    boardId: "main",
    anchor,
    anchorState: { status: "attached", resolvedPath: [0] },
    origin: { kind: "local" },
    status: "open",
    messages: [
      {
        id: "22222222-2222-4222-8222-222222222222",
        author: { kind: "user" },
        body: "Make this clearer",
        createdAt: now,
      },
    ],
    createdAt: now,
    updatedAt: now,
  };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path =
      typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    requests.push({ method, path, ...(body !== undefined && { body }) });
    if (method === "DELETE") {
      const messageId = path.match(/\/messages\/([^/]+)$/)?.[1];
      if (!messageId) return response({ removedId: threadId, boardId: "main" });
      // The daemon's split: a cloud message leaves a tombstone for whoever
      // already read it, a local one leaves nothing.
      thread = {
        ...thread,
        messages:
          thread.scope === "shared"
            ? thread.messages.map((message) =>
                message.id === messageId ? { ...message, body: "", deletedAt: now } : message,
              )
            : thread.messages.filter((message) => message.id !== messageId),
      };
      return response({ thread });
    }
    if (method === "PATCH") {
      if (body.resolved !== undefined) {
        thread = { ...thread, status: body.resolved ? "resolved" : "open" };
      }
      if (body.scope === "shared") {
        // Promotion recreates the conversation on the cloud, so it comes back
        // under a new id — the same thing the daemon does.
        return response({
          thread: {
            ...thread,
            id: promotedId,
            scope: "shared",
            origin: { kind: "published", slug: "review", versionId: "v1" },
          },
        });
      }
      return response({ thread });
    }
    if (path.startsWith("/api/comments/cloud")) {
      return response({ available: true, slug: "review", url: "https://review.velloo.dev/" });
    }
    if (path.includes("/messages")) {
      thread = {
        ...thread,
        messages: [
          ...thread.messages,
          {
            id: "33333333-3333-4333-8333-333333333333",
            author: { kind: "user" },
            body: body.body,
            createdAt: now,
          },
        ],
      };
      return response({ thread });
    }
    if (method === "POST") return response({ thread });
    return response({ threads: [thread] });
  }) as typeof fetch;

  useCanvas.setState({
    currentBoardId: "main",
    currentScreenId: "home",
    boards: {
      main: {
        id: "main",
        name: "Main",
        frames: [{ id: "home-frame", screen: "home", x: 0, y: 0, w: 1440, h: 900 }],
        groups: [],
      },
    },
    screens: { home: { id: "home", name: "Home", tree: { $ref: "Button", $id: "cta" } } },
    commentThreads: [],
    commentStatus: "open",
    commentScope: "all",
    cloudComments: undefined,
    activeCommentId: null,
    pendingCommentAnchor: null,
    cursorMode: "select",
    rightTab: "node",
    rightPaneCollapsed: false,
    selection: null,
    reveal: null,
    selectionIntent: "inspect",
    locateNode: realLocateNode,
    flyToBoardRect: realFlyToBoardRect,
  });
});

afterEach(() => {
  globalThis.fetch = realFetch;
  // A test that leaves a publish waiting parks a resolver in module state.
  useCanvas.getState().settlePublish(false);
});

describe("comment canvas store", () => {
  test("creates a pinned thread, replies, resolves, and filters it", async () => {
    useCanvas.getState().enterCommentMode();
    expect(useCanvas.getState().cursorMode).toBe("comment");
    useCanvas.getState().beginComment(anchor);
    expect(useCanvas.getState().pendingCommentAnchor).toEqual(anchor);

    await useCanvas.getState().createPendingComment("Make this clearer");
    expect(useCanvas.getState().activeCommentId).toBe(threadId);
    expect(useCanvas.getState().pendingCommentAnchor).toBeNull();

    await useCanvas.getState().replyToComment(threadId, "More direct, please");
    expect(useCanvas.getState().commentThreads[0]?.messages).toHaveLength(2);
    await useCanvas.getState().setCommentResolved(threadId, true);
    expect(useCanvas.getState().commentThreads).toEqual([]);

    expect(requests.map(({ method, path }) => `${method} ${path}`)).toEqual([
      "POST /api/comments",
      `POST /api/comments/${threadId}/messages`,
      `PATCH /api/comments/${threadId}`,
    ]);
  });

  test("taking one message back out of several leaves the conversation standing", async () => {
    useCanvas.getState().beginComment(anchor);
    await useCanvas.getState().createPendingComment("Ignore this one");
    await useCanvas.getState().replyToComment(threadId, "This is the real ask");
    const first = useCanvas.getState().commentThreads[0]?.messages[0];

    await useCanvas.getState().deleteCommentMessage(threadId, first?.id ?? "");
    const messages = useCanvas.getState().commentThreads[0]?.messages;
    // Local, so it left nothing behind — not even a tombstone.
    expect(messages?.map((message) => message.body)).toEqual(["This is the real ask"]);
    expect(useCanvas.getState().commentThreads).toHaveLength(1);
  });

  test("taking back a local thread's only message takes the thread with it", async () => {
    useCanvas.getState().beginComment(anchor);
    await useCanvas.getState().createPendingComment("Ignore this one");
    const first = useCanvas.getState().commentThreads[0]?.messages[0];

    await useCanvas.getState().deleteCommentMessage(threadId, first?.id ?? "");
    expect(useCanvas.getState().commentThreads).toEqual([]);
    // A thread with nothing in it is not a thread, so the whole thing goes —
    // the daemon is asked for the thread, never for an emptying message.
    expect(requests.at(-1)).toEqual({ method: "DELETE", path: `/api/comments/${threadId}` });
  });

  test("a cloud message is tombstoned rather than removed", async () => {
    thread = { ...thread, scope: "shared" };
    await useCanvas.getState().refreshComments();
    const first = useCanvas.getState().commentThreads[0]?.messages[0];

    await useCanvas.getState().deleteCommentMessage(threadId, first?.id ?? "");
    const messages = useCanvas.getState().commentThreads[0]?.messages;
    expect(messages?.[0]?.body).toBe("");
    expect(messages?.[0]?.deletedAt).toBeString();
    // Even as its last message: reviewers keep the thread they replied under.
    expect(useCanvas.getState().commentThreads).toHaveLength(1);
  });

  test("pins a cloud thread when the composer targets the cloud", async () => {
    useCanvas.getState().beginComment(anchor);
    await useCanvas.getState().createPendingComment("Reviewers should see this", "shared");
    expect(requests[0]?.body).toEqual({
      boardId: "main",
      body: "Reviewers should see this",
      anchor,
      scope: "shared",
    });
  });

  test("reads the board's cloud availability", async () => {
    await useCanvas.getState().refreshCloudComments();
    expect(useCanvas.getState().cloudComments).toEqual({
      available: true,
      slug: "review",
      url: "https://review.velloo.dev/",
    });
    expect(requests[0]?.path).toContain("/api/comments/cloud?boardId=main");
  });

  test("moving a thread to the cloud replaces it with the promoted thread", async () => {
    await useCanvas.getState().refreshComments();
    useCanvas.getState().setActiveComment(threadId);
    await useCanvas.getState().moveCommentToCloud(threadId);

    const threads = useCanvas.getState().commentThreads;
    expect(threads).toHaveLength(1);
    expect(threads[0]?.id).toBe(promotedId);
    expect(threads[0]?.scope).toBe("shared");
    expect(useCanvas.getState().activeCommentId).toBe(promotedId);
    expect(requests.at(-1)).toEqual({
      method: "PATCH",
      path: `/api/comments/${threadId}`,
      body: { scope: "shared" },
    });
  });

  test("a promoted thread leaves the list while the filter is local-only", async () => {
    useCanvas.setState({ commentScope: "local", commentThreads: [thread] });
    await useCanvas.getState().moveCommentToCloud(threadId);
    expect(useCanvas.getState().commentThreads).toEqual([]);
    expect(useCanvas.getState().activeCommentId).toBeNull();
  });

  test("refreshes threads and reveals an attached node when its pin opens", async () => {
    await useCanvas.getState().refreshComments();
    useCanvas.getState().setActiveComment(threadId);
    expect(useCanvas.getState().selection).toEqual({ screenId: "home", path: "0" });
    expect(useCanvas.getState().selectionIntent).toBe("preserve-tab");
    expect(useCanvas.getState().rightTab).toBe("comments");
    expect(requests[0]?.path).toContain("/api/comments?boardId=main&status=open&scope=all");
  });

  test("returns to the thread list and resolves without switching to the node tab", async () => {
    await useCanvas.getState().refreshComments();
    useCanvas.getState().setActiveComment(threadId);
    useCanvas.getState().setActiveComment(null);
    expect(useCanvas.getState().selection).toBeNull();
    expect(useCanvas.getState().rightTab).toBe("comments");

    useCanvas.getState().setActiveComment(threadId);
    await useCanvas.getState().setCommentResolved(threadId, true);
    expect(useCanvas.getState().activeCommentId).toBeNull();
    expect(useCanvas.getState().selection).toBeNull();
    expect(useCanvas.getState().rightTab).toBe("comments");

    useCanvas.setState({
      commentStatus: "resolved",
      commentThreads: [thread],
      activeCommentId: threadId,
      selection: { screenId: "home", path: "0" },
      rightTab: "comments",
    });
    await useCanvas.getState().setCommentResolved(threadId, false);
    expect(useCanvas.getState().activeCommentId).toBeNull();
    expect(useCanvas.getState().selection).toBeNull();
    expect(useCanvas.getState().rightTab).toBe("comments");
  });

  test("locates an attached comment in its exact anchored frame", async () => {
    let call:
      | {
          screenId: string;
          path: string;
          options?: { hostBoards?: string[]; frameId?: string; preserveTab?: boolean };
        }
      | undefined;
    useCanvas.setState({
      commentThreads: [thread],
      locateNode: async (screenId, path, options) => {
        call = { screenId, path, ...(options ? { options } : {}) };
      },
    });

    useCanvas.getState().locateComment(threadId);
    expect(call).toEqual({
      screenId: "home",
      path: "0",
      options: { frameId: "home-frame", preserveTab: true },
    });
  });

  /**
   * A cloud comment on a board with no link can't just be refused: publishing
   * is the thing that would make it possible, so posting walks the user
   * through it and then posts. The publish dialog still asks for confirmation
   * — this only hands it the board and waits for the verdict.
   */
  describe("a cloud comment on an unpublished board", () => {
    const unpublished = { available: false, reason: "unpublished" } as const;

    test("publishes the board first, then posts the thread", async () => {
      useCanvas.setState({ cloudComments: unpublished });
      useCanvas.getState().beginComment(anchor);
      const posting = useCanvas
        .getState()
        .createPendingComment("Reviewers should see this", "shared");

      expect(useCanvas.getState().publishOpen).toBe(true);
      expect(useCanvas.getState().publishScope).toMatchObject({ id: "main", name: "Main" });
      expect(requests.some((request) => request.method === "POST")).toBe(false);

      useCanvas.getState().settlePublish(true);
      expect(await posting).toBeNull();
      expect(requests.at(-1)).toEqual({
        method: "POST",
        path: "/api/comments",
        body: {
          boardId: "main",
          body: "Reviewers should see this",
          anchor,
          scope: "shared",
        },
      });
      expect(useCanvas.getState().pendingCommentAnchor).toBeNull();
    });

    test("a publish closed without one leaves the draft to say why", async () => {
      useCanvas.setState({ cloudComments: unpublished });
      useCanvas.getState().beginComment(anchor);
      const posting = useCanvas
        .getState()
        .createPendingComment("Reviewers should see this", "shared");

      // Closing the dialog by hand is the abandon path the composer reports.
      useCanvas.getState().setPublishOpen(false);
      expect(await posting).toContain("wasn't published");
      expect(requests.some((request) => request.method === "POST")).toBe(false);
      // The pin — and so the words typed against it — survive.
      expect(useCanvas.getState().pendingCommentAnchor).toEqual(anchor);
    });

    test("moving a thread there publishes with that thread's board chosen", async () => {
      useCanvas.setState({ cloudComments: unpublished, commentThreads: [thread] });
      const moving = useCanvas.getState().moveCommentToCloud(threadId);

      expect(useCanvas.getState().publishScope).toMatchObject({ id: "main" });
      expect(requests.some((request) => request.method === "PATCH")).toBe(false);

      useCanvas.getState().settlePublish(true);
      await moving;
      expect(requests.at(-1)).toEqual({
        method: "PATCH",
        path: `/api/comments/${threadId}`,
        body: { scope: "shared" },
      });
      expect(useCanvas.getState().commentThreads[0]?.scope).toBe("shared");
    });
  });

  test("creates a board-wide thread without an anchor or canvas pin", async () => {
    thread = { ...thread, anchor: undefined, anchorState: { status: "board" } };
    await useCanvas.getState().createBoardComment("Review the hierarchy across the board");

    expect(requests[0]).toEqual({
      method: "POST",
      path: "/api/comments",
      body: { boardId: "main", body: "Review the hierarchy across the board", scope: "local" },
    });
    expect(useCanvas.getState().commentThreads[0]?.anchor).toBeUndefined();
    expect(useCanvas.getState().rightTab).toBe("comments");
  });
});
