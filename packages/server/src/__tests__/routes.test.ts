import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../app.ts";
import { type DesignFolder, loadDesignFolder } from "../design-folder.ts";
import type { MutationContext } from "../mutations/index.ts";
import { TailwindJit } from "../styles/tailwind-jit.ts";

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
let jit: TailwindJit;

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
  jit = new TailwindJit(join(tmp, "pages"));
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("api routes", () => {
  test("/api/health returns ok", async () => {
    const app = createApp(() => ctx, jit);
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  test("/api/design returns the folder summary", async () => {
    const app = createApp(() => ctx, jit);
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
    const app = createApp(() => ctx, jit);
    const res = await app.request("/api/page/onboarding");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { name: string };
    expect(body.name).toBe("Onboarding");
  });

  test("/api/page/:id 404s on missing", async () => {
    const app = createApp(() => ctx, jit);
    const res = await app.request("/api/page/does-not-exist");
    expect(res.status).toBe(404);
  });

  test("/api/render/:pageId/:variantId returns HTML", async () => {
    const app = createApp(() => ctx, jit);
    const res = await app.request("/api/render/onboarding/mobile");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const body = await res.text();
    expect(body).toContain("<!doctype html>");
    expect(body).toContain("Hi");
    expect(body).toContain("data-node-path");
  });

  test("/api/render 404s on bad pageId", async () => {
    const app = createApp(() => ctx, jit);
    const res = await app.request("/api/render/missing/mobile");
    expect(res.status).toBe(404);
  });

  test("/api/render 404s on bad variantId", async () => {
    const app = createApp(() => ctx, jit);
    const res = await app.request("/api/render/onboarding/desktop");
    expect(res.status).toBe(404);
  });

  test("/api/mutate/update_props accepts an @id locator", async () => {
    const app = createApp(() => ctx, jit);
    // Assign an id to the root Card first.
    const setRes = await app.request("/api/mutate/set_node_id", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        pageId: "onboarding",
        variantId: "mobile",
        path: [],
        id: "root-card",
      }),
    });
    expect(setRes.status).toBe(200);
    // Now address it via the locator.
    const updateRes = await app.request("/api/mutate/update_props", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        pageId: "onboarding",
        variantId: "mobile",
        path: "@root-card",
        propPatch: { className: "p-6" },
      }),
    });
    expect(updateRes.status).toBe(200);
    const body = (await updateRes.json()) as { path: number[] };
    expect(body.path).toEqual([]);
  });

  test("/api/mutate/update_props returns 404 IdNotFound for an unknown @id", async () => {
    const app = createApp(() => ctx, jit);
    const res = await app.request("/api/mutate/update_props", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        pageId: "onboarding",
        variantId: "mobile",
        path: "@no-such-id",
        propPatch: { className: "p-6" },
      }),
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { kind: string; id: string } };
    expect(body.error.kind).toBe("IdNotFound");
    expect(body.error.id).toBe("no-such-id");
  });

  test("/api/mutate/add_node rejects an id collision with 409", async () => {
    const app = createApp(() => ctx, jit);
    // Add a node with id "first".
    const first = await app.request("/api/mutate/add_node", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        pageId: "onboarding",
        variantId: "mobile",
        parentPath: [],
        componentRef: "Badge",
        id: "first",
      }),
    });
    expect(first.status).toBe(200);
    // Try to add another with the same id → IdConflict → 409.
    const second = await app.request("/api/mutate/add_node", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        pageId: "onboarding",
        variantId: "mobile",
        parentPath: [],
        componentRef: "Badge",
        id: "first",
      }),
    });
    expect(second.status).toBe(409);
    const body = (await second.json()) as { error: { kind: string } };
    expect(body.error.kind).toBe("IdConflict");
  });

  test("/api/mutate/set_node_id rejects malformed ids at the route layer", async () => {
    const app = createApp(() => ctx, jit);
    const res = await app.request("/api/mutate/set_node_id", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        pageId: "onboarding",
        variantId: "mobile",
        path: [],
        id: "1-bad-leading-digit",
      }),
    });
    expect(res.status).toBe(400);
  });
});
