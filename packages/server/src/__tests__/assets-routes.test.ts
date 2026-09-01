import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assetPathFromSrc } from "@velloo/schema";
import { createProvider as createShadcnProvider } from "@velloo/shadcn-snapshot";
import { createApp } from "../app.ts";
import { readAssetsFile, recordGeneratedAssets } from "../assets-store.ts";
import { type DesignFolder, loadDesignFolder } from "../design-folder.ts";
import { CanvasBundler } from "../live/canvas-bundler.ts";
import { LiveBundler, liveExtensions } from "../live/component-bundler.ts";
import type { MutationContext } from "../mutations/index.ts";
import { TailwindJit } from "../styles/tailwind-jit.ts";

/**
 * Generated-asset provenance: the store behind the canvas's image panel.
 * Covers the two properties the panel depends on — a record survives the
 * round trip intact, and a folder with no (or a corrupt) assets.json degrades
 * to "nothing was generated" rather than failing.
 */

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

const record = {
  prompt: "a stylized ceramic teapot on a warm cream background",
  intent: "illustration",
  aspect: "1:1",
  width: 1024,
  height: 1024,
  generatedAt: "2026-08-22T14:00:00.000Z",
};

let tmp: string;
let folder: DesignFolder;
/** A daemon with no velloo-cloud connection at all. */
let app: ReturnType<typeof createApp>;
/** A signed-in daemon whose cloud is unreachable — port 1 always refuses. */
let appOffline: ReturnType<typeof createApp>;

beforeEach(async () => {
  tmp = join(tmpdir(), `velloo-assets-routes-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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
  appOffline = createApp(() => ctx, jit, bundler, canvasBundler, undefined, undefined, {
    url: "http://127.0.0.1:1",
    token: "vlk_test",
  });
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

const get = (path: string) => app.fetch(new Request(`http://localhost${path}`));

describe("assets store", () => {
  test("a folder that has never generated reports nothing, rather than failing", async () => {
    expect(await readAssetsFile(tmp)).toEqual({ version: 1, generated: {} });
  });

  test("a record survives the write/read round trip whole", async () => {
    await recordGeneratedAssets(tmp, { "assets/a.png": record });
    expect((await readAssetsFile(tmp)).generated["assets/a.png"]).toEqual(record);
  });

  test("recording merges rather than replacing", async () => {
    await recordGeneratedAssets(tmp, { "assets/a.png": record });
    await recordGeneratedAssets(tmp, { "assets/b.png": { ...record, prompt: "a mug" } });
    const { generated } = await readAssetsFile(tmp);
    expect(Object.keys(generated).sort()).toEqual(["assets/a.png", "assets/b.png"]);
  });

  test("concurrent writes don't drop a generation", async () => {
    // `count` and batched agent calls both land generations at once; a plain
    // read-modify-write would lose all but the last.
    await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        recordGeneratedAssets(tmp, { [`assets/n${i}.png`]: record }),
      ),
    );
    expect(Object.keys((await readAssetsFile(tmp)).generated).length).toBe(8);
  });

  test("a corrupt assets.json reads as empty instead of throwing", async () => {
    await writeFile(join(tmp, "assets.json"), "{ not json", "utf8");
    expect(await readAssetsFile(tmp)).toEqual({ version: 1, generated: {} });
    // A schema-valid-but-wrong shape degrades the same way.
    await writeFile(join(tmp, "assets.json"), JSON.stringify({ version: 9 }), "utf8");
    expect(await readAssetsFile(tmp)).toEqual({ version: 1, generated: {} });
  });

  test("a corrupt store is replaced, not merged into, on the next write", async () => {
    await writeFile(join(tmp, "assets.json"), "{ not json", "utf8");
    await recordGeneratedAssets(tmp, { "assets/a.png": record });
    const raw = JSON.parse(await readFile(join(tmp, "assets.json"), "utf8"));
    expect(raw).toEqual({ version: 1, generated: { "assets/a.png": record } });
  });
});

describe("GET /api/assets", () => {
  test("serves the provenance the canvas looks images up in", async () => {
    await recordGeneratedAssets(tmp, { "assets/a.png": record });
    const res = await get("/api/assets");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ generated: { "assets/a.png": record } });
  });

  test("an empty folder answers with an empty map, not a 404", async () => {
    const res = await get("/api/assets");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ generated: {} });
  });
});

describe("POST /api/assets/generate", () => {
  const generate = (body: unknown, target = app) =>
    target.fetch(
      new Request("http://localhost/api/assets/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );

  /**
   * The canvas reads `{ error: { code, message } }` and falls back to a bare
   * "<route>: <status>" when it can't find a message there. Every failure on
   * this path carries a written next step — sign in, top up, retry — so a flat
   * envelope turns all of them into an opaque status code on screen.
   */
  test("failures use the envelope the canvas can read a message out of", async () => {
    // createApp above is built without CloudAuth — the logged-out daemon.
    const res = await generate({ prompt: "a teapot", intent: "illustration" });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error?: { code?: string; message?: string } };
    expect(body.error?.code).toBe("LoggedOut");
    expect(body.error?.message).toContain("velloo login");
  });

  test("a malformed body is a 400 with a reason, before any cloud call", async () => {
    const res = await generate({ prompt: "", intent: "illustration" }, appOffline);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: { code?: string; message?: string } };
    expect(body.error?.code).toBe("BadRequest");
    expect(body.error?.message).toBeTruthy();
  });

  test("an intent outside the catalogue never reaches the cloud", async () => {
    const res = await generate({ prompt: "a teapot", intent: "nonsense" }, appOffline);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error?: { code?: string } }).error?.code).toBe("BadRequest");
  });

  test("an unreachable cloud explains itself rather than showing a bare status", async () => {
    // The failure a user actually hits when their cloud isn't running. It has
    // to arrive as a sentence, not as "/api/assets/generate: 502".
    const res = await generate({ prompt: "a teapot", intent: "illustration" }, appOffline);
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error?: { code?: string; message?: string } };
    expect(body.error?.code).toBe("Unreachable");
    expect(body.error?.message).toContain("velloo-cloud");
    expect(body.error?.message).toContain("nothing was generated or charged");
  });
});

describe("assetPathFromSrc", () => {
  test("maps the canvas's src forms onto store keys", () => {
    expect(assetPathFromSrc("/assets/hero.png")).toBe("assets/hero.png");
    expect(assetPathFromSrc("assets/hero.png")).toBe("assets/hero.png");
    expect(assetPathFromSrc("./assets/hero.png")).toBe("assets/hero.png");
    // A cache-buster is not part of the stored name.
    expect(assetPathFromSrc("/assets/hero.png?v=2")).toBe("assets/hero.png");
  });

  test("anything outside the folder's asset store has no provenance key", () => {
    expect(assetPathFromSrc("https://cdn.example.com/hero.png")).toBeNull();
    expect(assetPathFromSrc("/static/hero.png")).toBeNull();
    expect(assetPathFromSrc("/assets/")).toBeNull();
    expect(assetPathFromSrc("")).toBeNull();
  });
});
