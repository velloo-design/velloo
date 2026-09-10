import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CommentThread } from "@velloo/schema";
import { createProvider as createShadcnProvider } from "@velloo/shadcn-snapshot";
import { Hono } from "hono";
import type { CanvasCloudAccess, CanvasPublishSlot } from "../cloud.ts";
import { type DesignFolder, loadDesignFolder } from "../design-folder.ts";
import { type CloudCommentTargets, LocalCommentsService } from "../local-comments.ts";
import { registerCommentTools } from "../mcp/tools/comments.ts";
import type { McpResult } from "../mcp/tools/result.ts";
import type { MutationContext } from "../mutations/index.ts";
import { createCommentsRouter } from "../routes/comments.ts";
import type { WatchEvent } from "../watcher.ts";

const provider = createShadcnProvider();
const writeJson = (path: string, value: unknown) => writeFile(path, JSON.stringify(value));
const iso = () => new Date().toISOString();

let tmp: string;
let root: string;
let storePath: string;
let folder: DesignFolder;
let events: WatchEvent[];
let service: LocalCommentsService;
let app: Hono;

async function repoSnapshot(): Promise<Record<string, string>> {
  const files = (await readdir(root, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();
  return Object.fromEntries(
    await Promise.all(
      files.map(async (path) => [path.slice(root.length + 1), await readFile(path, "utf8")]),
    ),
  );
}

const request = (method: string, path: string, body?: unknown) =>
  app.fetch(
    new Request(`http://localhost${path}`, {
      method,
      ...(body === undefined
        ? {}
        : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    }),
  );

beforeEach(async () => {
  tmp = join(tmpdir(), `velloo-local-comments-${crypto.randomUUID()}`);
  root = join(tmp, "design");
  storePath = join(tmp, "user-data", "comments.json");
  for (const dir of [".design", "theme", "screens", "boards"]) {
    await mkdir(join(root, dir), { recursive: true });
  }
  await writeJson(join(root, ".design/config.json"), {
    schemaVersion: 3,
    toolVersion: "0.1.0",
    folderId: "folder-comments-test",
    libraries: {
      default: {
        id: "shadcn-upstream",
        version: "test",
        source: "binary",
        componentsPath: "binary",
      },
    },
    defaultLibrary: "default",
    viewportPresets: [{ name: "Desktop", w: 1440, h: 900 }],
  });
  await writeJson(join(root, "theme/default.json"), {
    name: "default",
    colors: {
      background: "oklch(1 0 0)",
      foreground: "oklch(0.145 0 0)",
      primary: { DEFAULT: "oklch(0.55 0.18 280)", foreground: "oklch(0.985 0 0)" },
    },
    typography: {},
    spacing: {},
    radius: {},
  });
  await writeJson(join(root, "screens/home.json"), {
    id: "home",
    name: "Home",
    tree: {
      $ref: "Box",
      children: [{ $ref: "Button", $id: "hero-cta", props: { children: "Start" } }],
    },
  });
  await writeJson(join(root, "boards/main.json"), {
    id: "main",
    name: "Main",
    frames: [{ id: "home-frame", screen: "home", x: 0, y: 0, w: 1440, h: 900 }],
  });
  await writeJson(join(root, "boards/other.json"), { id: "other", name: "Other", frames: [] });
  folder = await loadDesignFolder(root);
  events = [];
  const ctx: MutationContext = {
    folder,
    providers: { default: provider },
    defaultProvider: provider,
    broadcast: (event) => events.push(event as WatchEvent),
  };
  service = new LocalCommentsService(() => ctx, storePath);
  app = new Hono().route("/api/comments", createCommentsRouter(service));
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("local comment routes", () => {
  test("create, reply, resolve, reopen, filter, and delete a node thread", async () => {
    const createdResponse = await request("POST", "/api/comments", {
      boardId: "main",
      body: "Make this CTA more direct",
      anchor: {
        kind: "node",
        boardId: "main",
        frameId: "home-frame",
        screenId: "home",
        locator: "@hero-cta",
        bounds: { x: 40, y: 80, w: 120, h: 40 },
        fingerprint: { ref: "Button", text: "Start", ancestorIds: [] },
      },
    });
    expect(createdResponse.status).toBe(200);
    const created = (await createdResponse.json()) as {
      thread: { id: string; anchorState: unknown };
    };
    expect(created.thread.anchorState).toEqual({ status: "attached", resolvedPath: [0] });

    const replied = await request("POST", `/api/comments/${created.thread.id}/messages`, {
      body: "Updated the label and contrast.",
      author: { kind: "agent", displayName: "Velloo agent" },
    });
    expect(
      ((await replied.json()) as { thread: { messages: unknown[] } }).thread.messages,
    ).toHaveLength(2);

    const resolved = await request("PATCH", `/api/comments/${created.thread.id}`, {
      resolved: true,
    });
    expect(((await resolved.json()) as { thread: { status: string } }).thread.status).toBe(
      "resolved",
    );
    expect(
      (
        (await (await request("GET", "/api/comments?boardId=main")).json()) as {
          threads: unknown[];
        }
      ).threads,
    ).toHaveLength(0);
    expect(
      (
        (await (await request("GET", "/api/comments?boardId=main&status=resolved")).json()) as {
          threads: unknown[];
        }
      ).threads,
    ).toHaveLength(1);

    const reopened = await request("PATCH", `/api/comments/${created.thread.id}`, {
      resolved: false,
    });
    expect(((await reopened.json()) as { thread: { status: string } }).thread.status).toBe("open");
    expect((await request("DELETE", `/api/comments/${created.thread.id}`)).status).toBe(200);
    expect((await request("GET", `/api/comments/${created.thread.id}`)).status).toBe(404);
    expect(events).toHaveLength(5);
    expect(events.every((event) => event.type === "comments-changed")).toBe(true);
  });

  test("deleting one message on a local thread takes it out entirely", async () => {
    const created = (await (
      await request("POST", "/api/comments", { boardId: "main", body: "Ignore this one" })
    ).json()) as { thread: { id: string; messages: { id: string }[] } };
    const replied = (await (
      await request("POST", `/api/comments/${created.thread.id}/messages`, {
        body: "This is the real ask.",
      })
    ).json()) as { thread: { messages: { id: string }[] } };
    const target = replied.thread.messages[0]?.id;

    const response = await request(
      "DELETE",
      `/api/comments/${created.thread.id}/messages/${target}`,
    );
    expect(response.status).toBe(200);
    const { thread } = (await response.json()) as {
      thread: { messages: { body: string; deletedAt?: string }[] };
    };
    // Nobody outside this machine ever read it, so there is nothing to be
    // honest to about the gap — it is simply not there.
    expect(thread.messages.map((message) => message.body)).toEqual(["This is the real ask."]);
    expect(thread.messages[0]?.deletedAt).toBeUndefined();

    // And it is gone from the file, not just from the answer.
    const again = await request("DELETE", `/api/comments/${created.thread.id}/messages/${target}`);
    expect(again.status).toBe(404);
  });

  test("a local thread's last message is not the message endpoint's to take", async () => {
    const created = (await (
      await request("POST", "/api/comments", { boardId: "main", body: "Only message" })
    ).json()) as { thread: { id: string; messages: { id: string }[] } };

    const response = await request(
      "DELETE",
      `/api/comments/${created.thread.id}/messages/${created.thread.messages[0]?.id}`,
    );
    // An empty thread is not a thread. The canvas deletes the whole thing
    // instead, and the daemon holds the line for anything that doesn't.
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: { message: string } }).error.message).toContain(
      "delete the thread instead",
    );
    expect((await service.get(created.thread.id)).messages).toHaveLength(1);
  });

  test("deleting a message that isn't in the thread is a 404", async () => {
    const created = (await (
      await request("POST", "/api/comments", { boardId: "main", body: "Only message" })
    ).json()) as { thread: { id: string } };
    const response = await request(
      "DELETE",
      `/api/comments/${created.thread.id}/messages/${crypto.randomUUID()}`,
    );
    expect(response.status).toBe(404);
  });

  test("rejects anchors that do not belong to the named board and frame", async () => {
    const response = await request("POST", "/api/comments", {
      boardId: "main",
      body: "Mismatch",
      anchor: {
        kind: "node",
        boardId: "other",
        frameId: "missing",
        screenId: "home",
        locator: [],
        bounds: { x: 0, y: 0, w: 1, h: 1 },
      },
    });
    expect(response.status).toBe(400);
  });
});

describe("local comment persistence", () => {
  test("survives service restart without writing anything inside the repository", async () => {
    const before = await repoSnapshot();
    const created = await service.create({ boardId: "main", body: "Private working note" });
    const restarted = new LocalCommentsService(
      () => ({
        folder,
        providers: { default: provider },
        defaultProvider: provider,
        broadcast: () => undefined,
      }),
      storePath,
    );
    expect((await restarted.get(created.id)).messages[0]?.body).toBe("Private working note");
    expect(await repoSnapshot()).toEqual(before);
    expect(storePath.startsWith(root)).toBe(false);
  });

  test("isolates boards and serializes concurrent creates", async () => {
    await Promise.all([
      service.create({ boardId: "main", body: "one" }),
      service.create({ boardId: "main", body: "two" }),
      service.create({ boardId: "other", body: "other" }),
    ]);
    expect(await service.list("main", "all")).toHaveLength(2);
    expect(await service.list("other", "all")).toHaveLength(1);
  });

  test("preserves origin anchor context and reports a deleted target as stale", async () => {
    const created = await service.create({
      boardId: "main",
      body: "Keep the original target",
      anchor: {
        kind: "node",
        boardId: "main",
        frameId: "home-frame",
        screenId: "home",
        locator: "@hero-cta",
        bounds: { x: 40, y: 80, w: 120, h: 40 },
        fingerprint: { ref: "Button", text: "Start" },
      },
    });
    const home = folder.screens.get("home");
    expect(home).toBeDefined();
    if (!home) return;
    home.tree = { $ref: "Box", children: [] };
    const stale = await service.get(created.id);
    expect(stale.anchorState).toEqual({ status: "stale" });
    expect(stale.anchor).toEqual(created.anchor);
  });
});

describe("cloud comment scope", () => {
  const versionId = "55555555-5555-4555-8555-555555555555";
  let cloud: ReturnType<typeof Bun.serve>;
  let cloudThreads: Map<string, CommentThread>;

  const slot = (boardIds: string[]): CanvasPublishSlot => ({
    slug: "review-link",
    url: "https://review.velloo.dev/s/review-link/",
    title: "Review",
    teamId: null,
    latestVersionId: versionId,
    lastPublishedAt: "2026-08-28T09:00:00.000Z",
    context: { boardIds, contextKnown: true, repo: null, branch: null },
  });

  const targets = (
    slots: CanvasPublishSlot[],
    access: CanvasCloudAccess["state"] = "ready",
  ): CloudCommentTargets => ({
    access: async () => ({ state: access }),
    destinations: async () => ({ slots }),
  });

  const withCloud = (publish?: ReturnType<typeof targets>) =>
    new LocalCommentsService(
      () => ({
        folder,
        providers: { default: provider },
        defaultProvider: provider,
        broadcast: (event) => events.push(event as WatchEvent),
      }),
      storePath,
      { url: `http://127.0.0.1:${cloud.port}`, token: "vlk_test" },
      publish,
    );

  beforeEach(() => {
    cloudThreads = new Map();
    cloud = Bun.serve({
      port: 0,
      fetch: async (request) => {
        const url = new URL(request.url);
        if (request.method === "GET" && url.pathname === "/v1/comment-threads") {
          return Response.json({ threads: [...cloudThreads.values()], links: {}, now: iso() });
        }
        if (request.method === "POST" && url.pathname === "/v1/links/review-link/comment-threads") {
          const body = (await request.json()) as {
            versionId: string;
            boardId: string;
            body: string;
            authorKind: "user" | "agent";
          };
          const thread: CommentThread = {
            id: crypto.randomUUID(),
            scope: "shared",
            folderId: "folder-comments-test",
            boardId: body.boardId,
            origin: { kind: "published", slug: "review-link", versionId: body.versionId },
            status: "open",
            messages: [
              {
                id: crypto.randomUUID(),
                author: { kind: body.authorKind, displayName: "Owner" },
                body: body.body,
                createdAt: iso(),
              },
            ],
            createdAt: iso(),
            updatedAt: iso(),
          };
          cloudThreads.set(thread.id, thread);
          return Response.json({ thread }, { status: 201 });
        }
        const reply = url.pathname.match(/^\/v1\/comment-threads\/([^/]+)\/messages$/);
        if (request.method === "POST" && reply?.[1]) {
          const existing = cloudThreads.get(reply[1]);
          if (!existing) return new Response("not found", { status: 404 });
          const body = (await request.json()) as { body: string; authorKind: "user" | "agent" };
          const next: CommentThread = {
            ...existing,
            messages: [
              ...existing.messages,
              {
                id: crypto.randomUUID(),
                author: { kind: body.authorKind, displayName: "Owner" },
                body: body.body,
                createdAt: iso(),
              },
            ],
            updatedAt: iso(),
          };
          cloudThreads.set(next.id, next);
          return Response.json({ thread: next });
        }
        const retract = url.pathname.match(/^\/v1\/comment-threads\/([^/]+)\/messages\/([^/]+)$/);
        if (request.method === "DELETE" && retract?.[1]) {
          const existing = cloudThreads.get(retract[1]);
          if (!existing) return new Response("not found", { status: 404 });
          // The cloud only ever lets you take back your own; a reviewer's is
          // theirs, and refusing here is what the canvas has to cope with.
          const target = existing.messages.find((message) => message.id === retract[2]);
          if (target?.author.kind === "reviewer") {
            return Response.json(
              { error: "forbidden", message: "you can only delete your own comments" },
              {
                status: 403,
              },
            );
          }
          const next: CommentThread = {
            ...existing,
            messages: existing.messages.map((message) =>
              message.id === retract[2] ? { ...message, body: "", deletedAt: iso() } : message,
            ),
            updatedAt: iso(),
          };
          cloudThreads.set(next.id, next);
          return Response.json({ thread: next });
        }
        return new Response("not found", { status: 404 });
      },
    });
  });

  afterEach(() => cloud.stop(true));

  test("reports why a board cannot take a cloud thread", async () => {
    expect(await service.cloudAvailability("main")).toEqual({
      available: false,
      reason: "unsupported",
    });
    expect(await withCloud(targets([], "signed-out")).cloudAvailability("main")).toEqual({
      available: false,
      reason: "signed-out",
    });
    // Separate from "signed-out" because the way out is worded differently and
    // because a rejected credential used to pass for a working one.
    expect(await withCloud(targets([], "expired")).cloudAvailability("main")).toEqual({
      available: false,
      reason: "expired",
    });
    expect(await withCloud(targets([slot(["other"])])).cloudAvailability("main")).toEqual({
      available: false,
      reason: "unpublished",
    });
    expect(await withCloud(targets([slot(["main"])])).cloudAvailability("main")).toEqual({
      available: true,
      slug: "review-link",
      url: "https://review.velloo.dev/s/review-link/",
    });
  });

  test("creating with scope shared authors the thread on the published link", async () => {
    const shared = withCloud(targets([slot(["main"])]));
    const thread = await shared.create({
      boardId: "main",
      body: "Reviewers should see this",
      scope: "shared",
    });
    expect(thread.scope).toBe("shared");
    expect(thread.origin).toEqual({ kind: "published", slug: "review-link", versionId });
    // The person at the canvas is not their own agent.
    expect(thread.messages[0]?.author.kind).toBe("user");
    expect(cloudThreads.size).toBe(1);
    // Nothing landed in the machine-local store.
    expect(await shared.list("main", "all", "local")).toHaveLength(0);
  });

  test("a rejected credential refuses a cloud thread and says to sign in again", async () => {
    const shared = withCloud(targets([slot(["main"])], "expired"));
    await expect(
      shared.create({ boardId: "main", body: "Nowhere to put this", scope: "shared" }),
    ).rejects.toThrow("sign in again");
  });

  test("an unpublished board refuses a cloud thread instead of writing it locally", async () => {
    const shared = withCloud(targets([slot(["other"])]));
    await expect(
      shared.create({ boardId: "main", body: "Nowhere to put this", scope: "shared" }),
    ).rejects.toThrow("Publish this board");
    expect(await shared.list("main", "all")).toHaveLength(0);
  });

  test("promoting a local thread replays it to the cloud and drops the local copy", async () => {
    const shared = withCloud(targets([slot(["main"])]));
    const local = await shared.create({ boardId: "main", body: "Make the CTA clearer" });
    await shared.reply(local.id, {
      body: "Tightened the copy.",
      author: { kind: "agent", displayName: "Agent" },
    });

    const promoted = await shared.promoteToShared(local.id);
    expect(promoted.scope).toBe("shared");
    expect(promoted.messages.map((message) => message.body)).toEqual([
      "Make the CTA clearer",
      "Tightened the copy.",
    ]);
    // An exchange between the designer and their agent still reads as one
    // after the move: each message keeps the voice that wrote it.
    expect(promoted.messages.map((message) => message.author.kind)).toEqual(["user", "agent"]);
    expect(await shared.list("main", "all", "local")).toHaveLength(0);
    await expect(shared.get(local.id)).rejects.toThrow("No such comment thread");
  });

  test("taking back a message on a cloud thread goes to the cloud, not the local file", async () => {
    const shared = withCloud(targets([slot(["main"])]));
    const thread = await shared.create({ boardId: "main", body: "Cloud note", scope: "shared" });
    const first = thread.messages[0]?.id ?? "";

    const retracted = await shared.deleteMessage(thread.id, first);
    expect(retracted.scope).toBe("shared");
    expect(retracted.messages[0]?.body).toBe("");
    expect(retracted.messages[0]?.deletedAt).toBeString();
    // The tombstone came back from the cloud, so it is in the cloud's copy.
    expect(cloudThreads.get(thread.id)?.messages[0]?.deletedAt).toBeString();
    expect(await shared.list("main", "all", "local")).toHaveLength(0);
  });

  test("a reviewer's message is not ours to take back, and the refusal says so", async () => {
    const shared = withCloud(targets([slot(["main"])]));
    const thread = await shared.create({ boardId: "main", body: "Cloud note", scope: "shared" });
    const reviewer = { ...(thread.messages[0] as CommentThread["messages"][number]) };
    reviewer.id = crypto.randomUUID();
    reviewer.author = { kind: "reviewer", displayName: "jane.reviewer" };
    const stored = cloudThreads.get(thread.id) as CommentThread;
    cloudThreads.set(thread.id, { ...stored, messages: [...stored.messages, reviewer] });

    await expect(shared.deleteMessage(thread.id, reviewer.id)).rejects.toThrow(
      "you can only delete your own comments",
    );
  });

  test("promoting a thread leaves the messages that were taken back behind", async () => {
    const shared = withCloud(targets([slot(["main"])]));
    const local = await shared.create({ boardId: "main", body: "Ignore this one" });
    await shared.reply(local.id, { body: "This is the real ask." });
    await shared.deleteMessage(local.id, local.messages[0]?.id ?? "");

    const promoted = await shared.promoteToShared(local.id);
    // What reaches the reviewers is what was still there to read. A message
    // retracted while the thread was local never existed as far as they know.
    expect(promoted.messages.map((message) => message.body)).toEqual(["This is the real ask."]);
  });

  test("an agent replying to a cloud thread is not mistaken for the designer", async () => {
    const shared = withCloud(targets([slot(["main"])]));
    const thread = await shared.create({ boardId: "main", body: "Cloud note", scope: "shared" });
    const replied = await shared.reply(thread.id, {
      body: "Done — the hierarchy is fixed.",
      author: { kind: "agent", displayName: "Agent" },
    });
    expect(replied.messages.map((message) => message.author.kind)).toEqual(["user", "agent"]);

    const person = await shared.reply(thread.id, { body: "Confirmed, thanks." });
    expect(person.messages.at(-1)?.author.kind).toBe("user");
  });

  test("separates the scopes when listing a board", async () => {
    const shared = withCloud(targets([slot(["main"])]));
    await shared.create({ boardId: "main", body: "Local note" });
    await shared.create({ boardId: "main", body: "Cloud note", scope: "shared" });

    expect((await shared.list("main", "all")).map((thread) => thread.scope).sort()).toEqual([
      "local",
      "shared",
    ]);
    expect(await shared.list("main", "all", "local")).toHaveLength(1);
    expect((await shared.list("main", "all", "shared"))[0]?.messages[0]?.body).toBe("Cloud note");
  });
});

describe("agent comment tools", () => {
  test("lists shared threads alongside local ones with no queue to opt into", async () => {
    const handlers: Record<string, (args: Record<string, unknown>) => Promise<McpResult>> = {};
    const mcp = {
      registerTool(
        name: string,
        _definition: unknown,
        handler: (args: Record<string, unknown>) => Promise<McpResult>,
      ) {
        handlers[name] = handler;
      },
    } as unknown as McpServer;
    const shared = {
      id: "11111111-1111-4111-8111-111111111111",
      scope: "shared",
      folderId: "folder-comments-test",
      boardId: "main",
      anchor: { kind: "board", boardId: "main", x: 10, y: 20 },
      origin: {
        kind: "published",
        slug: "review-link",
        versionId: "22222222-2222-4222-8222-222222222222",
      },
      status: "open",
      messages: [
        {
          id: "33333333-3333-4333-8333-333333333333",
          author: { kind: "reviewer" },
          body: "Shared feedback",
          createdAt: "2026-08-28T10:00:00.000Z",
        },
      ],
      createdAt: "2026-08-28T10:00:00.000Z",
      updatedAt: "2026-08-28T10:00:00.000Z",
      anchorState: { status: "board" },
    } as const;
    registerCommentTools(mcp, {
      list: async () => [shared],
    } as unknown as LocalCommentsService);
    const response = await handlers.list_comment_threads?.({
      boardId: "main",
      scope: "shared",
    });
    const content = response?.content[0];
    if (content?.type !== "text") throw new Error("expected comment tool JSON");
    expect((JSON.parse(content.text) as { threads: Array<{ id: string }> }).threads[0]?.id).toBe(
      shared.id,
    );
  });

  test("lists every open thread, replies as agent, resolves, reopens, and deletes", async () => {
    const first = await service.create({ boardId: "main", body: "Make the button clearer" });
    const second = await service.create({ boardId: "other", body: "Remove this draft" });

    const handlers: Record<string, (args: Record<string, unknown>) => Promise<McpResult>> = {};
    const mcp = {
      registerTool(
        name: string,
        _definition: unknown,
        handler: (args: Record<string, unknown>) => Promise<McpResult>,
      ) {
        handlers[name] = handler;
      },
    } as unknown as McpServer;
    registerCommentTools(mcp, service);

    const call = async <T>(name: string, args: Record<string, unknown> = {}): Promise<T> => {
      const handler = handlers[name];
      if (!handler) throw new Error(`Missing ${name}`);
      const response = await handler(args);
      const firstContent = response.content[0];
      if (firstContent?.type !== "text") throw new Error(`No JSON from ${name}`);
      return JSON.parse(firstContent.text) as T;
    };

    expect(Object.keys(handlers).sort()).toEqual([
      "get_comment_thread",
      "list_comment_threads",
      "update_comment_thread",
    ]);
    const waiting = await call<{ threads: Array<{ id: string }> }>("list_comment_threads");
    expect(waiting.threads.map((thread: { id: string }) => thread.id).sort()).toEqual(
      [first.id, second.id].sort(),
    );

    // Reply and resolve in ONE call — the normal close-out. The reply has to
    // land on the thread before the status moves.
    const closed = await call<{
      thread: {
        status: string;
        messages: Array<{ author: { kind: string; displayName?: string }; body: string }>;
      };
    }>("update_comment_thread", {
      threadId: first.id,
      reply: "Changed the label and increased contrast.",
      status: "resolved",
    });
    expect(closed.thread.messages.at(-1)?.author).toEqual({
      kind: "agent",
      displayName: "Agent",
    });
    expect(closed.thread.messages.at(-1)?.body).toBe("Changed the label and increased contrast.");
    expect(closed.thread.status).toBe("resolved");

    // Status alone reopens it.
    expect(
      (
        await call<{ thread: { status: string } }>("update_comment_thread", {
          threadId: first.id,
          status: "open",
        })
      ).thread.status,
    ).toBe("open");

    // Reply alone leaves the status where it was.
    expect(
      (
        await call<{ thread: { status: string } }>("update_comment_thread", {
          threadId: first.id,
          reply: "One more thing.",
        })
      ).thread.status,
    ).toBe("open");

    expect(
      (
        await call<{ removedId: string }>("update_comment_thread", {
          threadId: second.id,
          status: "deleted",
        })
      ).removedId,
    ).toBe(second.id);
  });
});
