import { afterEach, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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
  expect(
    uploadLinkBundle({
      baseUrl: url,
      token: "t",
      link: { title: "x", visibility: "public" },
      form,
    }),
  ).rejects.toThrow(/storage backend unavailable.*the cloud is having trouble/);
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
        schemaVersion: 2,
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
