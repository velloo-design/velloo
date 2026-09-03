import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createProvider as createShadcnProvider } from "@velloo/shadcn-snapshot";
import { Hono } from "hono";
import { type DesignFolder, loadDesignFolder } from "../design-folder.ts";
import { LocalCommentsService } from "../local-comments.ts";
import { registerCommentTools } from "../mcp/tools/comments.ts";
import type { McpResult } from "../mcp/tools/result.ts";
import type { MutationContext } from "../mutations/index.ts";
import { createCommentsRouter } from "../routes/comments.ts";
import type { WatchEvent } from "../watcher.ts";

const provider = createShadcnProvider();
const writeJson = (path: string, value: unknown) => writeFile(path, JSON.stringify(value));

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

describe("agent comment tools", () => {
  test("treats every shared thread as agent-visible without an explicit queue flag", async () => {
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
      requestedOnly: true,
    });
    const content = response?.content[0];
    if (content?.type !== "text") throw new Error("expected comment tool JSON");
    expect((JSON.parse(content.text) as { threads: Array<{ id: string }> }).threads[0]?.id).toBe(
      shared.id,
    );
  });

  test("exposes the requested inbox, replies as agent, resolves, reopens, and deletes", async () => {
    const first = await service.create({ boardId: "main", body: "Make the button clearer" });
    const second = await service.create({ boardId: "other", body: "Remove this draft" });
    await service.setAgentRequested(first.id, true);

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
      "delete_comment_thread",
      "get_comment_thread",
      "list_comment_threads",
      "reopen_comment",
      "reply_to_comment",
      "resolve_comment",
    ]);
    const inbox = await call<{ threads: Array<{ id: string }> }>("list_comment_threads", {
      requestedOnly: true,
    });
    expect(inbox.threads.map((thread: { id: string }) => thread.id)).toEqual([first.id]);

    const replied = await call<{
      thread: { messages: Array<{ author: { kind: string; displayName?: string } }> };
    }>("reply_to_comment", {
      threadId: first.id,
      body: "Changed the label and increased contrast.",
    });
    expect(replied.thread.messages.at(-1)?.author).toEqual({
      kind: "agent",
      displayName: "Agent",
    });
    expect(
      (await call<{ thread: { status: string } }>("resolve_comment", { threadId: first.id })).thread
        .status,
    ).toBe("resolved");
    expect(
      (await call<{ thread: { status: string } }>("reopen_comment", { threadId: first.id })).thread
        .status,
    ).toBe("open");
    expect(
      (await call<{ removedId: string }>("delete_comment_thread", { threadId: second.id }))
        .removedId,
    ).toBe(second.id);
  });
});
