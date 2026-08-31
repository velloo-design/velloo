import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type CaptureManifest, captureDir, writeCaptureManifest } from "@velloo/renderer";
import { createProvider as createShadcnProvider } from "@velloo/shadcn-snapshot";
import { createApp } from "../app.ts";
import { type DesignFolder, loadDesignFolder } from "../design-folder.ts";
import { CanvasBundler } from "../live/canvas-bundler.ts";
import { LiveBundler, liveExtensions } from "../live/component-bundler.ts";
import type { MutationContext } from "../mutations/index.ts";
import { TailwindJit } from "../styles/tailwind-jit.ts";

const provider = createShadcnProvider();

const sampleConfig = {
  schemaVersion: 2,
  toolVersion: "0.1.0",
  libraries: {
    default: {
      id: "shadcn-upstream" as const,
      version: "test",
      source: "binary",
      componentsPath: "binary",
    },
  },
  defaultLibrary: "default",
  viewportPresets: [{ name: "Desktop", w: 1440, h: 900 }],
};

const sampleTheme = {
  name: "default",
  colors: {
    background: "oklch(1 0 0)",
    foreground: "oklch(0.145 0 0)",
    primary: { DEFAULT: "oklch(0.55 0.18 280)", foreground: "oklch(0.985 0 0)" },
  },
  typography: {},
  spacing: {},
  radius: {},
};

const manifest = (id: string, capturedAt: string): CaptureManifest => ({
  id,
  url: "https://app.example.com/dashboard",
  finalUrl: "https://app.example.com/dashboard",
  title: "Dashboard",
  capturedAt,
  viewport: { w: 1440, h: 900 },
  files: ["page.png", "dom.json"],
  assetCount: 0,
  nodeCount: 42,
  themeOnly: false,
});

let tmp: string;
let home: string;
let folder: DesignFolder;
let app: ReturnType<typeof createApp>;
const prevHome = process.env.VELLOO_HOME;

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "velloo-home-"));
  process.env.VELLOO_HOME = home;
  tmp = join(
    tmpdir(),
    `velloo-capture-routes-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(join(tmp, ".design"), { recursive: true });
  await mkdir(join(tmp, "theme"), { recursive: true });
  await mkdir(join(tmp, "screens"), { recursive: true });
  await writeFile(join(tmp, ".design/config.json"), JSON.stringify(sampleConfig), "utf8");
  await writeFile(join(tmp, "theme/default.json"), JSON.stringify(sampleTheme), "utf8");
  folder = await loadDesignFolder(tmp);
  const jit = new TailwindJit(provider, join(folder.root, "screens"));
  const bundler = new LiveBundler(
    folder.root,
    () => folder.config,
    () => liveExtensions(folder.config.extensions),
  );
  const canvasBundler = new CanvasBundler(
    folder.root,
    () => folder.config.hostApp,
    () => undefined,
  );
  const ctx: MutationContext = {
    folder,
    providers: { default: provider },
    defaultProvider: provider,
    broadcast: () => undefined,
  };
  app = createApp(() => ctx, jit, bundler, canvasBundler);
});

afterEach(async () => {
  if (prevHome === undefined) delete process.env.VELLOO_HOME;
  else process.env.VELLOO_HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
  await rm(tmp, { recursive: true, force: true });
});

const get = (path: string) => app.fetch(new Request(`http://localhost${path}`));

describe("GET /api/captures", () => {
  test("is empty before anything is captured", async () => {
    const res = await get("/api/captures");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ captures: [] });
  });

  test("lists stored captures newest first", async () => {
    writeCaptureManifest(captureDir(tmp, "aaa"), manifest("aaa", "2026-08-01T00:00:00.000Z"));
    writeCaptureManifest(captureDir(tmp, "bbb"), manifest("bbb", "2026-08-05T00:00:00.000Z"));
    const body = (await (await get("/api/captures")).json()) as { captures: CaptureManifest[] };
    expect(body.captures.map((c) => c.id)).toEqual(["bbb", "aaa"]);
  });
});

describe("GET /api/captures/:id/:file", () => {
  test("serves a capture artifact with its content type", async () => {
    const dir = captureDir(tmp, "aaa");
    writeCaptureManifest(dir, manifest("aaa", "2026-08-01T00:00:00.000Z"));
    await writeFile(join(dir, "dom.json"), '{"nodes":[]}', "utf8");
    const res = await get("/api/captures/aaa/dom.json");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(await res.text()).toBe('{"nodes":[]}');
  });

  test("serves a nested asset", async () => {
    const dir = captureDir(tmp, "aaa");
    writeCaptureManifest(dir, manifest("aaa", "2026-08-01T00:00:00.000Z"));
    await mkdir(join(dir, "assets"), { recursive: true });
    await writeFile(join(dir, "assets", "logo.svg"), "<svg/>", "utf8");
    const res = await get("/api/captures/aaa/assets/logo.svg");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/svg+xml");
  });

  test("rejects path traversal in the id and the file", async () => {
    // A capture id and file name both reach the filesystem, so both are
    // validated before any join — an escape must never read outside the store.
    expect((await get("/api/captures/..%2F..%2Fetc/passwd")).status).toBe(400);
    expect((await get("/api/captures/aaa/..%2F..%2Fconfig.json")).status).toBe(400);
    expect((await get("/api/captures/aaa/a/b/c.json")).status).toBe(400);
  });

  test("404s a file that isn't there", async () => {
    writeCaptureManifest(captureDir(tmp, "aaa"), manifest("aaa", "2026-08-01T00:00:00.000Z"));
    expect((await get("/api/captures/aaa/nope.png")).status).toBe(404);
  });
});

describe("DELETE /api/captures/:id", () => {
  test("removes a capture and then reports it gone", async () => {
    writeCaptureManifest(captureDir(tmp, "aaa"), manifest("aaa", "2026-08-01T00:00:00.000Z"));
    const del = await app.fetch(
      new Request("http://localhost/api/captures/aaa", { method: "DELETE" }),
    );
    expect(del.status).toBe(200);
    expect(((await (await get("/api/captures")).json()) as { captures: [] }).captures).toEqual([]);
    const again = await app.fetch(
      new Request("http://localhost/api/captures/aaa", { method: "DELETE" }),
    );
    expect(again.status).toBe(404);
  });
});

describe("local-only guard", () => {
  test("rejects a cross-origin capture read", async () => {
    const res = await app.fetch(
      new Request("http://localhost/api/captures", {
        headers: { origin: "https://evil.example" },
      }),
    );
    expect(res.status).toBe(403);
  });
});
