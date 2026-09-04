import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CommentThread } from "@velloo/schema";
import { SharedCommentsClient } from "../cloud-comments.ts";

const threadId = "11111111-1111-4111-8111-111111111111";
const messageId = "22222222-2222-4222-8222-222222222222";
const versionId = "33333333-3333-4333-8333-333333333333";
const folderId = "folder-shared-comments";
const now = "2026-08-28T10:00:00.000Z";

let root = "";
let cachePath = "";
let server: ReturnType<typeof Bun.serve>;
let calls: Array<{ method: string; path: string; auth: string | null }> = [];
let shared: CommentThread;

function resetThread(): CommentThread {
  return {
    id: threadId,
    scope: "shared",
    folderId,
    boardId: "main",
    anchor: { kind: "board", boardId: "main", x: 120, y: 96 },
    origin: { kind: "published", slug: "review-link", versionId },
    status: "open",
    messages: [
      {
        id: messageId,
        author: { kind: "reviewer", displayName: "Reviewer" },
        body: "Make the primary action clearer",
        createdAt: now,
      },
    ],
    createdAt: now,
    updatedAt: now,
  };
}

function startServer() {
  return Bun.serve({
    port: 0,
    fetch: async (request) => {
      const url = new URL(request.url);
      calls.push({
        method: request.method,
        path: `${url.pathname}${url.search}`,
        auth: request.headers.get("authorization"),
      });
      if (request.method === "GET" && url.pathname === "/v1/comment-threads") {
        return Response.json({ threads: [shared], links: { "review-link": "ok" }, now });
      }
      if (request.method === "POST" && url.pathname === "/v1/links/review-link/comment-threads") {
        const body = (await request.json()) as {
          versionId: string;
          boardId: string;
          body: string;
          authorKind: "user" | "agent";
        };
        if (body.versionId !== versionId) {
          return Response.json(
            { error: "not_found", message: "that published version does not belong to this link" },
            { status: 404 },
          );
        }
        return Response.json(
          {
            thread: {
              ...resetThread(),
              id: "44444444-4444-4444-8444-444444444444",
              messages: [
                {
                  id: crypto.randomUUID(),
                  author: { kind: body.authorKind, displayName: "Owner" },
                  body: body.body,
                  createdAt: now,
                },
              ],
            },
          },
          { status: 201 },
        );
      }
      if (request.method === "POST" && url.pathname.endsWith(`/${threadId}/messages`)) {
        const body = (await request.json()) as { body: string; authorKind: "user" | "agent" };
        shared = {
          ...shared,
          messages: [
            ...shared.messages,
            {
              id: crypto.randomUUID(),
              author: { kind: body.authorKind, displayName: "Owner" },
              body: body.body,
              createdAt: "2026-08-28T10:01:00.000Z",
            },
          ],
          updatedAt: "2026-08-28T10:01:00.000Z",
        };
        return Response.json({ thread: shared });
      }
      if (request.method === "PATCH" && url.pathname.endsWith(`/${threadId}`)) {
        const body = (await request.json()) as { resolved: boolean };
        shared = {
          ...shared,
          status: body.resolved ? "resolved" : "open",
          updatedAt: "2026-08-28T10:02:00.000Z",
          ...(body.resolved
            ? { resolvedAt: "2026-08-28T10:02:00.000Z" }
            : { resolvedAt: undefined }),
        };
        return Response.json({ thread: shared });
      }
      return new Response("not found", { status: 404 });
    },
  });
}

function client(token = "vlk_test") {
  return new SharedCommentsClient(
    () => folderId,
    { url: `http://127.0.0.1:${server.port}`, token },
    () => cachePath,
  );
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "velloo-shared-comments-"));
  cachePath = join(root, "comments.shared.json");
  shared = resetThread();
  server = startServer();
});

afterAll(async () => {
  server.stop(true);
  await rm(root, { recursive: true, force: true });
});

describe("shared comment projection", () => {
  test("fetches a folder-scoped conversation and persists it outside the repo", async () => {
    calls = [];
    const result = await client().refresh();
    expect(result.status).toBe("ok");
    expect(result.changed).toBe(true);
    expect(result.threads[0]).toEqual(shared);
    expect(calls[0]).toEqual({
      method: "GET",
      path: `/v1/comment-threads?folderId=${folderId}&status=all`,
      auth: "Bearer vlk_test",
    });
    expect(client().cachedSync()).toEqual([shared]);
  });

  test("declares which owner-side voice replied rather than letting the cloud guess", async () => {
    calls = [];
    const c = client();
    const agent = await c.reply(threadId, "Updated the action hierarchy", "agent");
    expect(agent.messages.at(-1)).toMatchObject({
      author: { kind: "agent" },
      body: "Updated the action hierarchy",
    });
    const person = await c.reply(threadId, "Thanks, that reads much better", "user");
    expect(person.messages.at(-1)).toMatchObject({
      author: { kind: "user" },
      body: "Thanks, that reads much better",
    });
    const resolved = await c.setResolved(threadId, true);
    expect(resolved.status).toBe("resolved");
    expect(calls.map((call) => call.method)).toContain("POST");
    expect(calls.map((call) => call.method)).toContain("PATCH");
    expect(c.cachedSync()[0]?.status).toBe("resolved");
  });

  test("authors a thread on the published link and relays the cloud's refusal", async () => {
    const c = client();
    const created = await c.create("review-link", {
      versionId,
      boardId: "main",
      body: "Reviewers should see this",
      authorKind: "user",
    });
    expect(created.scope).toBe("shared");
    expect(created.messages[0]).toMatchObject({
      author: { kind: "user" },
      body: "Reviewers should see this",
    });

    await expect(
      c.create("review-link", {
        versionId: threadId,
        boardId: "main",
        body: "Stale version",
        authorKind: "user",
      }),
    ).rejects.toThrow("that published version does not belong to this link (not_found)");
  });

  test("serves the durable projection when logged out or offline", async () => {
    const loggedOut = await client("").refresh();
    expect(loggedOut.status).toBe("logged-out");
    expect(loggedOut.threads[0]?.id).toBe(threadId);

    server.stop(true);
    const offline = await client().refresh();
    expect(offline.status).toBe("offline");
    expect(offline.threads[0]?.status).toBe("resolved");
    server = startServer();
  });
});
