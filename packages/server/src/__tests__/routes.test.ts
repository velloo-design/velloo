import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../app.ts";
import { type DesignFolder, loadDesignFolder } from "../design-folder.ts";
import type { MutationContext } from "../mutations/index.ts";

const sampleConfig = {
  schemaVersion: 1,
  toolVersion: "0.1.0",
  componentSource: { framework: "shadcn-react", snapshotVersion: "test" },
  viewportPresets: [{ name: "Mobile", w: 390, h: 844 }],
};

const sampleTheme = {
  name: "default",
  colors: {
    background: "oklch(1 0 0)",
    foreground: "oklch(0 0 0)",
    primary: { DEFAULT: "oklch(0.205 0 0)", foreground: "oklch(0.985 0 0)" },
  },
  typography: {},
  spacing: {},
  radius: {},
};

const samplePage = {
  name: "Onboarding",
  variants: [
    {
      id: "mobile",
      name: "Mobile",
      viewport: { w: 390, h: 844 },
      tree: { $ref: "Card", children: [{ $ref: "Button", props: { children: "Hi" } }] },
    },
  ],
};

let tmp: string;
let folder: DesignFolder;
let ctx: MutationContext;

async function writeJson(path: string, value: unknown) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

beforeEach(async () => {
  tmp = join(tmpdir(), `velloo-server-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(join(tmp, ".design"), { recursive: true });
  await mkdir(join(tmp, "theme"), { recursive: true });
  await mkdir(join(tmp, "pages"), { recursive: true });
  await writeJson(join(tmp, ".design/config.json"), sampleConfig);
  await writeJson(join(tmp, "theme/default.json"), sampleTheme);
  await writeJson(join(tmp, "pages/onboarding.json"), samplePage);
  folder = await loadDesignFolder(tmp);
  ctx = { folder, broadcast: () => {} };
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("api routes", () => {
  test("/api/health returns ok", async () => {
    const app = createApp(() => ctx);
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  test("/api/design returns the folder summary", async () => {
    const app = createApp(() => ctx);
    const res = await app.request("/api/design");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      pages: Array<{ id: string; name: string; variants: Array<{ id: string }> }>;
    };
    expect(body.pages).toHaveLength(1);
    expect(body.pages[0]?.id).toBe("onboarding");
    expect(body.pages[0]?.variants[0]?.id).toBe("mobile");
  });

  test("/api/page/:id returns the full page", async () => {
    const app = createApp(() => ctx);
    const res = await app.request("/api/page/onboarding");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { name: string };
    expect(body.name).toBe("Onboarding");
  });

  test("/api/page/:id 404s on missing", async () => {
    const app = createApp(() => ctx);
    const res = await app.request("/api/page/does-not-exist");
    expect(res.status).toBe(404);
  });

  test("/api/render/:pageId/:variantId returns HTML", async () => {
    const app = createApp(() => ctx);
    const res = await app.request("/api/render/onboarding/mobile");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const body = await res.text();
    expect(body).toContain("<!doctype html>");
    expect(body).toContain("Hi");
    expect(body).toContain("data-node-path");
  });

  test("/api/render 404s on bad pageId", async () => {
    const app = createApp(() => ctx);
    const res = await app.request("/api/render/missing/mobile");
    expect(res.status).toBe(404);
  });

  test("/api/render 404s on bad variantId", async () => {
    const app = createApp(() => ctx);
    const res = await app.request("/api/render/onboarding/desktop");
    expect(res.status).toBe(404);
  });
});
