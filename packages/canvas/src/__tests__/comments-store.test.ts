import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { CommentAnchor, CommentThreadView } from "@velloo/schema";
import { useCanvas } from "../store.ts";

const realFetch = globalThis.fetch;
const now = "2026-08-28T10:00:00.000Z";
const threadId = "11111111-1111-4111-8111-111111111111";
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
    if (method === "DELETE") return response({ removedId: threadId, boardId: "main" });
    if (method === "PATCH") {
      if (body.resolved !== undefined) {
        thread = { ...thread, status: body.resolved ? "resolved" : "open" };
      }
      if (body.agentRequested !== undefined) {
        thread = {
          ...thread,
          ...(body.agentRequested ? { agentRequestedAt: now } : { agentRequestedAt: undefined }),
        };
      }
      return response({ thread });
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
    activeCommentId: null,
    pendingCommentAnchor: null,
    cursorMode: "select",
  });
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("comment canvas store", () => {
  test("creates a pinned thread, replies, queues the agent, resolves, and filters it", async () => {
    useCanvas.getState().enterCommentMode();
    expect(useCanvas.getState().cursorMode).toBe("comment");
    useCanvas.getState().beginComment(anchor);
    expect(useCanvas.getState().pendingCommentAnchor).toEqual(anchor);

    await useCanvas.getState().createPendingComment("Make this clearer");
    expect(useCanvas.getState().activeCommentId).toBe(threadId);
    expect(useCanvas.getState().pendingCommentAnchor).toBeNull();

    await useCanvas.getState().replyToComment(threadId, "More direct, please");
    expect(useCanvas.getState().commentThreads[0]?.messages).toHaveLength(2);
    await useCanvas.getState().setCommentAgentRequested(threadId, true);
    expect(useCanvas.getState().commentThreads[0]?.agentRequestedAt).toBe(now);
    await useCanvas.getState().setCommentResolved(threadId, true);
    expect(useCanvas.getState().commentThreads).toEqual([]);

    expect(requests.map(({ method, path }) => `${method} ${path}`)).toEqual([
      "POST /api/comments",
      `POST /api/comments/${threadId}/messages`,
      `PATCH /api/comments/${threadId}`,
      `PATCH /api/comments/${threadId}`,
    ]);
  });

  test("refreshes threads and reveals an attached node when its pin opens", async () => {
    await useCanvas.getState().refreshComments();
    useCanvas.getState().setActiveComment(threadId);
    expect(useCanvas.getState().selection).toEqual({ screenId: "home", path: "0" });
    expect(useCanvas.getState().rightTab).toBe("comments");
    expect(requests[0]?.path).toContain("/api/comments?boardId=main&status=open");
  });

  test("creates a board-wide thread without an anchor or canvas pin", async () => {
    thread = { ...thread, anchor: undefined, anchorState: { status: "board" } };
    await useCanvas.getState().createBoardComment("Review the hierarchy across the board");

    expect(requests[0]).toEqual({
      method: "POST",
      path: "/api/comments",
      body: { boardId: "main", body: "Review the hierarchy across the board" },
    });
    expect(useCanvas.getState().commentThreads[0]?.anchor).toBeUndefined();
    expect(useCanvas.getState().rightTab).toBe("comments");
  });
});
