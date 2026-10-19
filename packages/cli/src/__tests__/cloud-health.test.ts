import { afterEach, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describeCloudError } from "@velloo/protocol";
import type { Server } from "bun";
import { checkCloudHealth } from "../cloud.ts";
import { uploadLinkBundle } from "../cloud-upload.ts";

/**
 * The 2026-07-09 outage spent minutes on screenshots before a dead
 * blob store answered 500 — knowable up front from GET /health. These cover
 * the health gate's contract (ok / unreachable / unhealthy, with old clouds
 * passing) and the softened 5xx upload wording.
 */

let server: Server<undefined> | null = null;

afterEach(() => {
  server?.stop(true);
  server = null;
});

function serveCloud(handler: (req: Request) => Response | Promise<Response>): string {
  server = Bun.serve({ port: 0, fetch: handler });
  return `http://localhost:${server.port}`;
}

test("healthy cloud passes", async () => {
  const url = serveCloud(() => Response.json({ ok: true, db: { ok: true }, blob: { ok: true } }));
  expect(await checkCloudHealth(url)).toEqual({ status: "ok" });
});

test("a degraded cloud names the dead dependency", async () => {
  const url = serveCloud(() =>
    Response.json({ ok: false, db: { ok: true }, blob: { ok: false } }, { status: 503 }),
  );
  const health = await checkCloudHealth(url);
  expect(health.status).toBe("unhealthy");
  if (health.status === "unhealthy") {
    expect(health.detail).toContain("storage backend");
    expect(health.detail).not.toContain("database");
  }
});

test("both dependencies down reads as one sentence", async () => {
  const url = serveCloud(() =>
    Response.json({ ok: false, db: { ok: false }, blob: { ok: false } }, { status: 503 }),
  );
  const health = await checkCloudHealth(url);
  if (health.status !== "unhealthy") throw new Error(`expected unhealthy, got ${health.status}`);
  expect(health.detail).toContain("database and storage backend");
});

test("a cloud without /health (404, non-JSON) must not block", async () => {
  const url = serveCloud(() => new Response("not found", { status: 404 }));
  expect(await checkCloudHealth(url)).toEqual({ status: "ok" });
});

test("an unreachable cloud is distinct from an unhealthy one", async () => {
  const url = serveCloud(() => Response.json({ ok: true }));
  server?.stop(true);
  server = null;
  const health = await checkCloudHealth(url);
  expect(health.status).toBe("unreachable");
  if (health.status === "unreachable") expect(health.reason.length).toBeGreaterThan(0);
});

test("a 5xx upload failure carries the trouble hint, not a bare internal error", async () => {
  const url = serveCloud((req) => {
    const { pathname } = new URL(req.url);
    if (req.method === "POST" && pathname === "/v1/links") {
      return Response.json(
        { slug: "s", visibility: "public", passwordProtected: false },
        { status: 201 },
      );
    }
    if (req.method === "POST" && pathname.endsWith("/versions")) {
      return Response.json(
        { error: "storage_unavailable", message: "storage backend unavailable" },
        { status: 503 },
      );
    }
    return Response.json({ ok: true }, { status: 200 });
  });
  const form = new FormData();
  form.append("file", new File(["{}"], "design.json", { type: "application/json" }));
  const failed = await uploadLinkBundle({
    baseUrl: url,
    token: "t",
    link: { title: "x", visibility: "public", publishMode: "new" },
    form,
  });
  expect(failed.ok).toBe(false);
  if (failed.ok) return;
  expect(failed.error.kind).toBe("HttpFailure");
  expect(describeCloudError(failed.error)).toMatch(
    /storage backend unavailable.*the cloud is having trouble/,
  );
});

test("version upload retries one transient 5xx and succeeds", async () => {
  let attempts = 0;
  const url = serveCloud((req) => {
    const { pathname } = new URL(req.url);
    if (req.method === "POST" && pathname === "/v1/links") {
      return Response.json(
        { slug: "retry", visibility: "public", passwordProtected: false },
        { status: 201 },
      );
    }
    if (req.method === "POST" && pathname.endsWith("/versions")) {
      attempts += 1;
      return attempts === 1
        ? Response.json({ message: "temporary" }, { status: 503 })
        : Response.json({ files: 1, bytes: 2, url: "/s/retry/" }, { status: 201 });
    }
    return new Response("not found", { status: 404 });
  });
  const form = new FormData();
  form.append("file", new File(["{}"], "design.json"));
  const uploaded = await uploadLinkBundle({
    baseUrl: url,
    token: "t",
    link: { title: "x", visibility: "public", publishMode: "new" },
    form,
  });
  expect(attempts).toBe(2);
  expect(uploaded.ok).toBe(true);
  if (!uploaded.ok) return;
  expect(uploaded.value.shareUrl).toBe(`${url}/s/retry/`);
});

test("version upload times out, retries once, and reports an actionable failure", async () => {
  let attempts = 0;
  const deleted: string[] = [];
  let retryArrived!: () => void;
  const retried = new Promise<void>((resolve) => {
    retryArrived = resolve;
  });
  const url = serveCloud((req) => {
    const { pathname } = new URL(req.url);
    if (req.method === "POST" && pathname === "/v1/links") {
      return Response.json(
        { slug: "slow", visibility: "public", passwordProtected: false },
        { status: 201 },
      );
    }
    if (req.method === "POST" && pathname.endsWith("/versions")) {
      attempts += 1;
      if (attempts === 2) retryArrived();
      // Never answer: the client's own timeout is what has to end this. A
      // fixed sleep instead races the timeout, and under a loaded parallel
      // run the second abort can beat the handler that counts it.
      return new Promise<Response>(() => {});
    }
    if (req.method === "DELETE") {
      deleted.push(pathname);
      return Response.json({ ok: true });
    }
    return new Response("not found", { status: 404 });
  });
  const form = new FormData();
  form.append("file", new File(["{}"], "design.json"));
  const timedOut = await uploadLinkBundle({
    baseUrl: url,
    token: "t",
    link: { title: "x", visibility: "public", publishMode: "new" },
    form,
    uploadTimeoutMs: 100,
  });
  expect(timedOut.ok).toBe(false);
  if (timedOut.ok) return;
  expect(timedOut.error.kind).toBe("Unreachable");
  expect(describeCloudError(timedOut.error)).toMatch(
    /timed out.*2 attempts.*check your connection/i,
  );
  await retried;
  expect(attempts).toBe(2);
  // The link this publish created holds no version: it is taken down, not
  // left as an empty share page.
  expect(deleted).toEqual(["/v1/links/slow"]);
});

const created = () =>
  Response.json({ slug: "s", visibility: "public", passwordProtected: false }, { status: 201 });

/** A cloud that answers the upload with these lines, `gapMs` apart. */
function progressLines(lines: unknown[], gapMs: number): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      async start(controller) {
        for (const line of lines) {
          controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
          await Bun.sleep(gapMs);
        }
        controller.close();
      },
    }),
    { status: 200, headers: { "content-type": "application/x-ndjson" } },
  );
}

test("an upload that keeps moving outlasts the idle deadline", async () => {
  const seen: { accept: string | null; length: string | null; received: number }[] = [];
  const url = serveCloud(async (req) => {
    const { pathname } = new URL(req.url);
    if (req.method === "POST" && pathname === "/v1/links") return created();
    if (req.method === "POST" && pathname.endsWith("/versions")) {
      // Read the body at about 8 MB/s: the 16 MB upload outlasts the deadline
      // twice over, but no gap between chunks comes near one. Paced by bytes,
      // since how the body is chunked varies with load.
      let received = 0;
      for await (const chunk of req.body ?? []) {
        received += chunk.byteLength;
        await Bun.sleep(chunk.byteLength / 8_000);
      }
      seen.push({
        accept: req.headers.get("accept"),
        length: req.headers.get("content-length"),
        received,
      });
      return Response.json({ files: 1, bytes: received, url: "/s/s/" }, { status: 201 });
    }
    return new Response("not found", { status: 404 });
  });
  const form = new FormData();
  form.append("file", new File([new Uint8Array(16 * 1024 * 1024)], "screenshots/big.png"));
  const sent: number[] = [];
  const started = performance.now();
  const uploaded = await uploadLinkBundle({
    baseUrl: url,
    token: "t",
    link: { title: "x", visibility: "public", publishMode: "new" },
    form,
    uploadTimeoutMs: 1000,
    uploadRetries: 0,
    onProgress: (p) => {
      if (p.stage === "sending") sent.push(p.done);
    },
  });
  expect(uploaded.ok).toBe(true);
  expect(performance.now() - started).toBeGreaterThan(1000);
  const [request] = seen;
  if (!request) throw new Error("the upload never reached the cloud");
  expect(seen).toHaveLength(1);
  expect(request.accept).toContain("application/x-ndjson");
  expect(Number(request.length)).toBe(request.received);
  expect(sent.at(-1)).toBe(request.received);
});

test("a cloud's progress lines keep the upload alive and end in its result", async () => {
  const url = serveCloud((req) => {
    const { pathname } = new URL(req.url);
    if (req.method === "POST" && pathname === "/v1/links") return created();
    if (req.method === "POST" && pathname.endsWith("/versions")) {
      return progressLines(
        [
          ...[1, 2, 3].map((done) => ({ type: "progress", stage: "processing", done, total: 3 })),
          ...[1, 2, 3].map((done) => ({ type: "progress", stage: "storing", done, total: 3 })),
          { type: "result", status: 201, body: { files: 3, bytes: 9, url: "/s/s/" } },
        ],
        80,
      );
    }
    return new Response("not found", { status: 404 });
  });
  const form = new FormData();
  form.append("file", new File(["{}"], "design.json"));
  const stages: string[] = [];
  const uploaded = await uploadLinkBundle({
    baseUrl: url,
    token: "t",
    link: { title: "x", visibility: "public", publishMode: "new" },
    form,
    uploadTimeoutMs: 200,
    uploadRetries: 0,
    onProgress: (p) => stages.push(`${p.stage} ${p.done}/${p.total}`),
  });
  expect(uploaded.ok).toBe(true);
  if (!uploaded.ok) return;
  expect(uploaded.value.files).toBe(3);
  expect(stages).toContain("processing 3/3");
  expect(stages.at(-1)).toBe("storing 3/3");
});

test("an error in a cloud's result line is the upload's error, and the new link goes", async () => {
  const deleted: string[] = [];
  const url = serveCloud((req) => {
    const { pathname } = new URL(req.url);
    if (req.method === "POST" && pathname === "/v1/links") return created();
    if (req.method === "POST" && pathname.endsWith("/versions")) {
      return progressLines(
        [
          { type: "progress", stage: "processing", done: 1, total: 2 },
          {
            type: "result",
            status: 413,
            body: { error: "payload_too_large", message: "'big.png' is over the 12MB limit" },
          },
        ],
        0,
      );
    }
    if (req.method === "DELETE") deleted.push(pathname);
    return Response.json({ ok: true });
  });
  const form = new FormData();
  form.append("file", new File(["{}"], "design.json"));
  const failed = await uploadLinkBundle({
    baseUrl: url,
    token: "t",
    link: { title: "x", visibility: "public", publishMode: "new" },
    form,
  });
  expect(failed.ok).toBe(false);
  if (failed.ok) return;
  expect(failed.error.kind).toBe("HttpFailure");
  expect(describeCloudError(failed.error)).toContain("over the 12MB limit");
  expect(deleted).toEqual(["/v1/links/s"]);
});

test("a progress stream that ends without a result is retried, then reported", async () => {
  let attempts = 0;
  const url = serveCloud((req) => {
    const { pathname } = new URL(req.url);
    if (req.method === "POST" && pathname === "/v1/links") return created();
    if (req.method === "POST" && pathname.endsWith("/versions")) {
      attempts += 1;
      return progressLines([{ type: "progress", stage: "storing", done: 1, total: 2 }], 0);
    }
    return Response.json({ ok: true });
  });
  const form = new FormData();
  form.append("file", new File(["{}"], "design.json"));
  const failed = await uploadLinkBundle({
    baseUrl: url,
    token: "t",
    link: { title: "x", visibility: "public", publishMode: "new" },
    form,
  });
  expect(attempts).toBe(2);
  expect(failed.ok).toBe(false);
  if (failed.ok) return;
  expect(describeCloudError(failed.error)).toMatch(/closed the upload before answering/);
});

test("a timed-out upload to a reused link leaves the link in place", async () => {
  const deleted: string[] = [];
  const url = serveCloud((req) => {
    const { pathname } = new URL(req.url);
    if (req.method === "POST" && pathname === "/v1/links") {
      return Response.json(
        { slug: "kept", visibility: "public", passwordProtected: false },
        { status: 200 },
      );
    }
    if (req.method === "PUT" && pathname === "/v1/links/kept/access") {
      return Response.json({ visibility: "public", passwordProtected: false });
    }
    if (req.method === "POST" && pathname.endsWith("/versions")) {
      return new Promise<Response>(() => {});
    }
    if (req.method === "DELETE") deleted.push(pathname);
    return new Response("not found", { status: 404 });
  });
  const form = new FormData();
  form.append("file", new File(["{}"], "design.json"));
  const timedOut = await uploadLinkBundle({
    baseUrl: url,
    token: "t",
    link: { folderId: "f", slug: "kept", title: "x", visibility: "public", publishMode: "update" },
    form,
    uploadTimeoutMs: 50,
    uploadRetries: 0,
  });
  expect(timedOut.ok).toBe(false);
  expect(deleted).toEqual([]);
});

test("reusing a stable link applies the privacy mode before uploading", async () => {
  const requests: { method: string; pathname: string; body?: unknown }[] = [];
  const url = serveCloud(async (req) => {
    const { pathname } = new URL(req.url);
    requests.push({
      method: req.method,
      pathname,
      ...(req.headers.get("content-type")?.includes("application/json")
        ? { body: await req.json() }
        : {}),
    });
    if (req.method === "POST" && pathname === "/v1/links") {
      return Response.json(
        { slug: "stable", visibility: "public", passwordProtected: false },
        { status: 200 },
      );
    }
    if (req.method === "PUT" && pathname === "/v1/links/stable/access") {
      return Response.json({ visibility: "private", passwordProtected: false });
    }
    if (req.method === "POST" && pathname === "/v1/links/stable/versions") {
      return Response.json({ files: 1, bytes: 2, url: "/s/stable/" }, { status: 201 });
    }
    return new Response("not found", { status: 404 });
  });
  const form = new FormData();
  form.append("file", new File(["{}"], "design.json", { type: "application/json" }));

  const uploaded = await uploadLinkBundle({
    baseUrl: url,
    token: "t",
    link: {
      folderId: "folder-stable",
      title: "x",
      visibility: "private",
      publishMode: "update",
      expectedVersionId: "11111111-1111-4111-8111-111111111111",
      slug: "stable",
    },
    form,
  });

  expect(uploaded.ok).toBe(true);
  if (!uploaded.ok) return;
  expect(uploaded.value.link).toEqual({
    slug: "stable",
    visibility: "private",
    passwordProtected: false,
  });
  expect(requests[1]).toEqual({
    method: "PUT",
    pathname: "/v1/links/stable/access",
    body: {
      visibility: "private",
      password: null,
      passwordExpiresAt: null,
      expectedVersionId: "11111111-1111-4111-8111-111111111111",
    },
  });
});

// The command-level contract: publish exits with the health verdict BEFORE any
// screenshot capture or upload — the stub counts /v1 calls to prove it.
test("velloo publish fails fast on an unhealthy cloud", async () => {
  let apiCalls = 0;
  const url = serveCloud((req) => {
    const { pathname } = new URL(req.url);
    if (pathname === "/health") {
      return Response.json({ ok: false, db: { ok: true }, blob: { ok: false } }, { status: 503 });
    }
    if (pathname.startsWith("/v1/")) apiCalls++;
    return new Response("not found", { status: 404 });
  });

  const tmp = join(tmpdir(), `velloo-health-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const design = join(tmp, "velloo");
  try {
    // Minimal loadable folder — publish validates the folder before /health,
    // so the fixture must clear loadDesignFolder (config + theme).
    await mkdir(join(design, ".design"), { recursive: true });
    await mkdir(join(design, "theme"), { recursive: true });
    await writeFile(
      join(design, ".design", "config.json"),
      JSON.stringify({
        schemaVersion: 4,
        name: "test",
        toolVersion: "0.0.1",
        libraries: {
          default: { id: "none", version: "0.1.0", source: "binary", componentsPath: "binary" },
        },
        defaultLibrary: "default",
        viewportPresets: [{ name: "Desktop", w: 1440, h: 900 }],
      }),
    );
    await writeFile(
      join(design, "theme", "default.json"),
      JSON.stringify({
        name: "default",
        colors: {
          background: "oklch(1 0 0)",
          foreground: "oklch(0.145 0 0)",
          primary: { DEFAULT: "oklch(0.55 0.18 280)", foreground: "oklch(0.985 0 0)" },
        },
        typography: {},
        spacing: {},
        radius: {},
      }),
    );
    const proc = Bun.spawn(
      [
        "bun",
        resolve(import.meta.dir, "../cli.ts"),
        "publish",
        design,
        "--url",
        url,
        "--token",
        "t",
        "--public",
      ],
      { cwd: resolve(import.meta.dir, "../../../.."), stdout: "pipe", stderr: "pipe" },
    );
    const exitCode = await proc.exited;
    const stderr = await new Response(proc.stderr).text();
    expect(exitCode).toBe(1);
    expect(stderr).toContain("storage backend");
    expect(apiCalls).toBe(0);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
