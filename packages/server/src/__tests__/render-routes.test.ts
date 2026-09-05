import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProvider as createShadcnProvider } from "@velloo/shadcn-snapshot";
import { createApp } from "../app.ts";
import { type DesignFolder, loadDesignFolder } from "../design-folder.ts";
import { CanvasBundler } from "../live/canvas-bundler.ts";
import { LiveBundler, liveExtensions } from "../live/component-bundler.ts";
import type { MutationContext } from "../mutations/index.ts";
import { TailwindJit } from "../styles/tailwind-jit.ts";
import { designConfig, designTheme } from "../testing/design-folder.ts";

const provider = createShadcnProvider();

/**
 * Integration tests for the `/api/render/snippet*` routes. Guards two
 * recent regressions:
 *
 *  - `/snippet/:id` (library tile + detail preview) must wrap the
 *    snippet in a centering Card so it doesn't render top-left.
 *  - `/snippet-body/:id` (snippet editor view) must NOT add a
 *    centering wrapper, otherwise paths reported by iframe-runtime
 *    clicks would shift and Inspector edits would target the wrong
 *    node.
 */

const sampleConfig = designConfig();

const sampleTheme = designTheme();

const sampleSnippet = {
  id: "stat-card",
  name: "Stat Card",
  params: [
    { name: "label", type: "string" as const, default: "Active users" },
    { name: "value", type: "string" as const, default: "1,284" },
  ],
  tree: {
    $ref: "Card",
    props: { className: "p-4 flex flex-col gap-1" },
    children: [
      { $ref: "Text", props: { children: { $param: "label" } } },
      { $ref: "Heading", props: { level: 2, children: { $param: "value" } } },
    ],
  },
};

async function writeJson(path: string, value: unknown) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

let tmp: string;
let folder: DesignFolder;
let app: ReturnType<typeof createApp>;
let jit: TailwindJit;

beforeEach(async () => {
  tmp = join(tmpdir(), `velloo-render-routes-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(join(tmp, ".design"), { recursive: true });
  await mkdir(join(tmp, "theme"), { recursive: true });
  await mkdir(join(tmp, "screens"), { recursive: true });
  await mkdir(join(tmp, "snippets"), { recursive: true });
  await writeJson(join(tmp, ".design/config.json"), sampleConfig);
  await writeJson(join(tmp, "theme/default.json"), sampleTheme);
  await writeJson(join(tmp, "snippets/stat-card.json"), sampleSnippet);
  folder = await loadDesignFolder(tmp);
  jit = new TailwindJit(provider, join(folder.root, "screens"));
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
  await rm(tmp, { recursive: true, force: true });
});

describe("local-only guard", () => {
  test("rejects a cross-origin request with 403", async () => {
    const res = await app.fetch(
      new Request("http://localhost/api/render/snippet/stat-card", {
        headers: { origin: "https://evil.example" },
      }),
    );
    expect(res.status).toBe(403);
  });

  test("rejects a rebinding request (non-loopback host) with 403", async () => {
    const res = await app.fetch(new Request("http://attacker.test/api/render/snippet/stat-card"));
    expect(res.status).toBe(403);
  });

  test("allows a same-origin loopback request", async () => {
    const res = await app.fetch(
      new Request("http://localhost/api/render/snippet/stat-card", {
        headers: { origin: "http://localhost" },
      }),
    );
    expect(res.status).toBe(200);
  });
});

describe("/api/render/snippet/:id (preview route)", () => {
  test("wraps the snippet in a centering Card so library previews don't pin top-left", async () => {
    const res = await app.fetch(new Request("http://localhost/api/render/snippet/stat-card"));
    expect(res.status).toBe(200);
    const html = await res.text();
    // The centering wrapper is marked with `data-velloo-snippet-preview`
    // and carries the flex / centering Tailwind classes. Asserting on
    // the data attribute is durable across class-string rewrites.
    expect(html).toContain('data-velloo-snippet-preview="true"');
    expect(html).toContain("items-center");
    expect(html).toContain("justify-center");
    // The wrapper carries padding so the snippet has breathing room.
    expect(html).toMatch(/p-\d/);
    // The snippet content itself still renders inside the wrapper.
    expect(html).toContain("Active users");
    expect(html).toContain("1,284");
  });

  test("404 for an unknown snippet id", async () => {
    const res = await app.fetch(new Request("http://localhost/api/render/snippet/no-such"));
    expect(res.status).toBe(404);
  });
});

describe("/api/render/snippet-body/:id (editor route)", () => {
  test("renders the snippet body without the centering wrapper", async () => {
    // Critical: the body route is used by the snippet editor view to
    // surface internal click paths. Wrapping the body in another node
    // would shift every reported path by +1 and silently break
    // Inspector-driven edits.
    const res = await app.fetch(new Request("http://localhost/api/render/snippet-body/stat-card"));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).not.toContain("data-velloo-snippet-preview");
    // The body's root node should have data-node-path="" — the
    // identity of the snippet body root.
    expect(html).toContain('data-node-path=""');
    // `$param` refs are substituted for *prop* positions, so the
    // defaults flow through to the rendered output.
    expect(html).toContain("Active users");
    expect(html).toContain("1,284");
  });

  test("404 for an unknown snippet id", async () => {
    const res = await app.fetch(new Request("http://localhost/api/render/snippet-body/no-such"));
    expect(res.status).toBe(404);
  });
});

describe("/api/live/bundle.js (live-island bundle)", () => {
  test("serves a valid JS module (empty when no live extensions)", async () => {
    const res = await app.fetch(new Request("http://localhost/api/live/bundle.js"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/javascript");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.text();
    expect(body).toContain("export const components");
  });

  test("sets a permissive CORS header so screenshot/compare can import it cross-origin", async () => {
    // The screenshot path renders via Playwright setContent (opaque origin) and
    // imports this module via <base href>; ES module imports are CORS-gated, so
    // without the wildcard the live nodes silently fall back to placeholders.
    const res = await app.fetch(new Request("http://localhost/api/live/bundle.js"));
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });
});
