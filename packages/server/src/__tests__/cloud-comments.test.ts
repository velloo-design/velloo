import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AnnotationSchema } from "@velloo/schema";
import type { Server } from "bun";
import {
  type CommentSyncContext,
  countUnresolvedPulledComments,
  pullComments,
} from "../cloud-comments.ts";
import { loadDesignFolder } from "../design-folder.ts";
import { persistAnnotations } from "../mutations/persist.ts";
import type { WatchEvent } from "../watcher.ts";

/**
 * Share-link comments → annotations, against an in-process stub
 * cloud. Covers conversion + idempotent re-pulls, resolution in both
 * directions, the since-cursor, revoked-link surfacing, and the logged-out /
 * unpublished no-ops (nothing may break offline).
 */

interface StubComment {
  id: string;
  slug: string;
  screenId: string;
  nodePath?: string | null;
  author?: string | null;
  body: string;
  resolved: boolean;
}

// The default folder is cloud-published: it carries a folderId, which is the
// only thing the pull needs (the cloud resolves the folder's links from it).
const FOLDER_ID = "folder-uuid-1234";
const config = {
  schemaVersion: 3,
  toolVersion: "test",
  folderId: FOLDER_ID,
  libraries: {
    default: { id: "shadcn-upstream", version: "test", source: "binary", componentsPath: "binary" },
  },
  defaultLibrary: "default",
  viewportPresets: [{ name: "Desktop", w: 1440, h: 900 }],
};

const theme = {
  name: "test",
  colors: {
    background: "#fff",
    foreground: "#000",
    primary: { DEFAULT: "#000", foreground: "#fff" },
  },
  typography: {},
  spacing: {},
  radius: {},
};

let tmp: string;
let server: Server<undefined>;
let base: string;
let stub: {
  comments: StubComment[];
  links: Record<string, "ok" | "revoked" | "unknown">;
  now: string;
  queries: URLSearchParams[];
  patches: Array<{ id: string; body: unknown }>;
};

beforeEach(async () => {
  tmp = join(tmpdir(), `velloo-comments-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(join(tmp, ".design"), { recursive: true });
  await mkdir(join(tmp, "theme"), { recursive: true });
  await mkdir(join(tmp, "screens"), { recursive: true });
  await writeFile(join(tmp, ".design", "config.json"), JSON.stringify(config));
  await writeFile(join(tmp, "theme", "default.json"), JSON.stringify(theme));
  await writeFile(
    join(tmp, "screens", "home.json"),
    JSON.stringify({
      id: "home",
      name: "Home",
      tree: { $ref: "Box", children: [{ $ref: "Card" }] },
    }),
  );

  stub = {
    comments: [],
    links: { demo: "ok" },
    now: "2026-07-03T00:00:00.000Z",
    queries: [],
    patches: [],
  };
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (req.method === "GET" && url.pathname === "/v1/comments") {
        stub.queries.push(url.searchParams);
        return Response.json({ comments: stub.comments, links: stub.links, now: stub.now });
      }
      const patchMatch = url.pathname.match(/^\/v1\/comments\/(.+)$/);
      if (req.method === "PATCH" && patchMatch) {
        const id = decodeURIComponent(patchMatch[1] as string);
        stub.patches.push({ id, body: await req.json() });
        return Response.json({ id, resolved: true });
      }
      return new Response("not found", { status: 404 });
    },
  });
  base = `http://localhost:${server.port}`;
});

afterEach(async () => {
  server.stop(true);
  await rm(tmp, { recursive: true, force: true });
});

async function makeCtx(): Promise<CommentSyncContext & { events: WatchEvent[] }> {
  const folder = await loadDesignFolder(tmp);
  const events: WatchEvent[] = [];
  return { folder, events, broadcast: (e) => events.push(e) };
}

const cloud = () => ({ url: base, token: "vlk_test" });

test("logged out is a silent no-op — no requests, no annotations", async () => {
  const ctx = await makeCtx();
  const summary = await pullComments(ctx, { url: base });
  expect(summary.status).toBe("logged-out");
  expect(summary.pulled).toBe(0);
  expect(stub.queries.length).toBe(0);
  expect(ctx.folder.annotations.get("home")).toEqual([]);
});

test("a never-published folder (no folderId) is a no-op without touching the network", async () => {
  const { folderId: _dropped, ...unpublished } = config;
  await writeFile(join(tmp, ".design", "config.json"), JSON.stringify(unpublished));
  const ctx = await makeCtx();
  const summary = await pullComments(ctx, cloud());
  expect(summary.status).toBe("no-links");
  expect(stub.queries.length).toBe(0);
});

test("the pull is keyed by folderId alone", async () => {
  stub.comments = [
    { id: "c1", slug: "demo", screenId: "home", nodePath: "0", body: "hi", resolved: false },
  ];
  const ctx = await makeCtx();
  const summary = await pullComments(ctx, cloud());
  expect(summary.status).toBe("ok");
  expect(summary.pulled).toBe(1);
  const query = stub.queries[0];
  expect(query?.get("folderId")).toBe(FOLDER_ID);
  expect(query?.get("slugs")).toBeNull();
});

test("a folder-discovered link triggers one full re-pull, then the cursor resumes", async () => {
  const ctx = await makeCtx();
  await pullComments(ctx, cloud()); // records the cursor + known slugs
  expect(stub.queries.length).toBe(1);

  // The cloud now reveals a link this machine never pulled (published from
  // another clone) with a comment older than the cursor.
  stub.links = { demo: "ok", elsewhere: "ok" };
  stub.comments = [
    { id: "c9", slug: "elsewhere", screenId: "home", nodePath: "0", body: "old", resolved: false },
  ];
  const second = await pullComments(ctx, cloud());
  expect(second.pulled).toBe(1);
  // Incremental pull + the full re-pull it triggered.
  expect(stub.queries.length).toBe(3);
  expect(stub.queries[1]?.get("since")).not.toBeNull();
  expect(stub.queries[2]?.get("since")).toBeNull();

  // The discovered slug is now known — the next pull stays incremental.
  await pullComments(ctx, cloud());
  expect(stub.queries.length).toBe(4);
  expect(stub.queries[3]?.get("since")).not.toBeNull();
});

test("an unreachable cloud reports an error without breaking anything", async () => {
  const ctx = await makeCtx();
  const summary = await pullComments(ctx, { url: "http://127.0.0.1:1", token: "vlk_test" });
  expect(summary.status).toBe("error");
  expect(summary.note).toContain("velloo-cloud");
});

describe("pull → annotations", () => {
  test("lands new unresolved comments as anchored annotations, idempotently", async () => {
    stub.comments = [
      {
        id: "c1",
        slug: "demo",
        screenId: "home",
        nodePath: "0",
        author: "Dana",
        body: "This card needs more contrast",
        resolved: false,
      },
      {
        id: "c2",
        slug: "demo",
        screenId: "home",
        nodePath: null,
        body: "Love it",
        resolved: false,
      },
      // A dangling nodePath (tree changed since publish) anchors at the root.
      {
        id: "c3",
        slug: "demo",
        screenId: "home",
        nodePath: "5.2",
        body: "Old anchor",
        resolved: false,
      },
    ];
    const ctx = await makeCtx();
    const first = await pullComments(ctx, cloud());
    expect(first.status).toBe("ok");
    expect(first.pulled).toBe(3);
    expect(first.links).toEqual({ demo: "ok" });

    const anns = ctx.folder.annotations.get("home") ?? [];
    expect(anns.length).toBe(3);
    const c1 = anns.find((a) => a.cloud?.commentId === "c1");
    expect(c1?.target.locator).toEqual([0]);
    expect(c1?.author).toBe("user");
    expect(c1?.body).toContain("This card needs more contrast");
    expect(c1?.body).toContain("Dana");
    expect(c1?.body).toContain("demo");
    expect(c1?.cloud).toEqual({ commentId: "c1", slug: "demo", author: "Dana" });
    // No nodePath — screen-level (root) anchor; ditto the dangling path.
    expect(anns.find((a) => a.cloud?.commentId === "c2")?.target.locator).toEqual([]);
    expect(anns.find((a) => a.cloud?.commentId === "c3")?.target.locator).toEqual([]);
    // The sidecar on disk is schema-valid.
    const raw = JSON.parse(await readFile(join(tmp, "screens", "home.annotations.json"), "utf8"));
    for (const a of raw) AnnotationSchema.parse(a);
    expect(ctx.events.some((e) => e.type === "annotations-changed")).toBe(true);

    // Re-pull: no duplicates, and the cursor from the first pull is sent back.
    const second = await pullComments(ctx, cloud());
    expect(second.pulled).toBe(0);
    expect((ctx.folder.annotations.get("home") ?? []).length).toBe(3);
    expect(stub.queries[0]?.get("since")).toBeNull();
    expect(stub.queries[1]?.get("since")).toBe(stub.now);
    expect(stub.queries[1]?.get("folderId")).toBe(FOLDER_ID);
  });

  test("state loss does not duplicate — annotations are re-adopted by comment id", async () => {
    stub.comments = [
      { id: "c1", slug: "demo", screenId: "home", nodePath: "0", body: "hi", resolved: false },
    ];
    const ctx = await makeCtx();
    await pullComments(ctx, cloud());
    await rm(join(tmp, ".design", "cache", "comments.json"));
    const again = await pullComments(ctx, cloud());
    expect(again.pulled).toBe(0);
    expect((ctx.folder.annotations.get("home") ?? []).length).toBe(1);
  });
});

describe("resolution round-trip", () => {
  test("cloud-resolved comments remove their local annotation (down)", async () => {
    stub.comments = [
      { id: "c1", slug: "demo", screenId: "home", nodePath: "0", body: "fix", resolved: false },
    ];
    const ctx = await makeCtx();
    await pullComments(ctx, cloud());
    expect((ctx.folder.annotations.get("home") ?? []).length).toBe(1);

    stub.comments = [{ ...(stub.comments[0] as StubComment), resolved: true }];
    const summary = await pullComments(ctx, cloud());
    expect(summary.resolvedDown).toBe(1);
    expect(ctx.folder.annotations.get("home")).toEqual([]);
    // And nothing is PATCHed up for it afterwards.
    expect(stub.patches).toEqual([]);
    const later = await pullComments(ctx, cloud());
    expect(later.resolvedDown).toBe(0);
    expect(stub.patches).toEqual([]);
  });

  test("locally deleted pulled annotations PATCH the comment resolved (up)", async () => {
    stub.comments = [
      { id: "c1", slug: "demo", screenId: "home", nodePath: "0", body: "fix", resolved: false },
      { id: "c2", slug: "demo", screenId: "home", nodePath: null, body: "keep", resolved: false },
    ];
    const ctx = await makeCtx();
    await pullComments(ctx, cloud());

    // The user (or agent) resolves c1 locally by deleting its annotation.
    const anns = ctx.folder.annotations.get("home") ?? [];
    const remaining = anns.filter((a) => a.cloud?.commentId !== "c1");
    await persistAnnotations(ctx.folder, "home", remaining);

    const summary = await pullComments(ctx, cloud());
    expect(summary.resolvedUp).toBe(1);
    expect(stub.patches).toEqual([{ id: "c1", body: { resolved: true } }]);
    // Settled: the next pull neither re-lands nor re-PATCHes it.
    const later = await pullComments(ctx, cloud());
    expect(later.pulled).toBe(0);
    expect(later.resolvedUp).toBe(0);
    expect(stub.patches.length).toBe(1);
    expect((ctx.folder.annotations.get("home") ?? []).map((a) => a.cloud?.commentId)).toEqual([
      "c2",
    ]);
  });
});

test("revoked links surface in the summary", async () => {
  stub.links = { demo: "revoked" };
  const ctx = await makeCtx();
  const summary = await pullComments(ctx, cloud());
  expect(summary.status).toBe("ok");
  expect(summary.links).toEqual({ demo: "revoked" });
  expect(summary.note).toContain("demo");
  expect(summary.note?.toLowerCase()).toContain("revoked");
});

describe("unresolved waiting count", () => {
  test("pull reports unresolvedTotal; a local annotation delete drops the count immediately", async () => {
    stub.comments = [
      { id: "c1", slug: "demo", screenId: "home", nodePath: "0", body: "fix", resolved: false },
      { id: "c2", slug: "demo", screenId: "home", nodePath: null, body: "also", resolved: false },
    ];
    const ctx = await makeCtx();
    // Cold cache / nothing pulled yet: nothing waiting.
    expect(countUnresolvedPulledComments(ctx.folder)).toBe(0);

    const first = await pullComments(ctx, cloud());
    expect(first.unresolvedTotal).toBe(2);
    expect(countUnresolvedPulledComments(ctx.folder)).toBe(2);

    // Local delete = resolved locally: the count reflects it BEFORE any
    // network round-trip (the PATCH-up happens on the next pull).
    const anns = ctx.folder.annotations.get("home") ?? [];
    await persistAnnotations(
      ctx.folder,
      "home",
      anns.filter((a) => a.cloud?.commentId !== "c1"),
    );
    expect(countUnresolvedPulledComments(ctx.folder)).toBe(1);

    const second = await pullComments(ctx, cloud());
    expect(second.resolvedUp).toBe(1);
    expect(second.unresolvedTotal).toBe(1);
  });

  test("locally authored annotations never count — only pulled (cloud) ones", async () => {
    const ctx = await makeCtx();
    await persistAnnotations(ctx.folder, "home", [
      { id: "ann_local1", target: { locator: [] }, position: "auto", body: "mine", author: "user" },
    ]);
    expect(countUnresolvedPulledComments(ctx.folder)).toBe(0);
  });

  test("logged-out and no-links summaries still report the local count", async () => {
    stub.comments = [
      { id: "c1", slug: "demo", screenId: "home", nodePath: "0", body: "fix", resolved: false },
    ];
    const ctx = await makeCtx();
    await pullComments(ctx, cloud());

    const loggedOut = await pullComments(ctx, { url: base });
    expect(loggedOut.status).toBe("logged-out");
    expect(loggedOut.unresolvedTotal).toBe(1);

    // A clone whose config predates the publish (no folderId) still reports
    // the annotations that already live on disk.
    const { folderId: _dropped, ...unpublished } = config;
    await writeFile(join(tmp, ".design", "config.json"), JSON.stringify(unpublished));
    const fresh = await makeCtx();
    const noLinks = await pullComments(fresh, cloud());
    expect(noLinks.status).toBe("no-links");
    expect(noLinks.unresolvedTotal).toBe(1);
  });

  test("a cloud-side resolve removes the annotation and the count follows", async () => {
    stub.comments = [
      { id: "c1", slug: "demo", screenId: "home", nodePath: "0", body: "fix", resolved: false },
    ];
    const ctx = await makeCtx();
    await pullComments(ctx, cloud());
    expect(countUnresolvedPulledComments(ctx.folder)).toBe(1);

    stub.comments = [{ ...(stub.comments[0] as StubComment), resolved: true }];
    const summary = await pullComments(ctx, cloud());
    expect(summary.resolvedDown).toBe(1);
    expect(summary.unresolvedTotal).toBe(0);
    expect(countUnresolvedPulledComments(ctx.folder)).toBe(0);
  });
});

test("comments for screens that no longer exist are skipped, not fatal", async () => {
  stub.comments = [
    { id: "cx", slug: "demo", screenId: "gone", nodePath: null, body: "??", resolved: false },
  ];
  const ctx = await makeCtx();
  const summary = await pullComments(ctx, cloud());
  expect(summary.status).toBe("ok");
  expect(summary.pulled).toBe(0);
});
