import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { captureScreenshot, captureUrlScreenshot, diffPngs } from "@velloo/renderer";
import type { Viewport } from "@velloo/schema";
import { createApp } from "../app.ts";
import { CanvasBundler } from "../live/canvas-bundler.ts";
import { LiveBundler, liveExtensions } from "../live/component-bundler.ts";
import { styleDiffForRegions } from "../mcp/tools/computed.ts";
import { regionNode } from "../mcp/tools/screenshot-helpers.ts";
import { TailwindJit } from "../styles/tailwind-jit.ts";
import { testContext } from "../testing/design-folder.ts";

/**
 * The whole `compare_to_url` style-diff path, against a real page.
 *
 * The unit tests fix the pairing and diffing logic; what they cannot check is
 * that the two sides actually land in one coordinate space — the design render
 * measured in its CSS pixels, the page in its own, and the diff regions in
 * image pixels at some scale. Getting that wrong doesn't crash: it silently
 * pairs a node with the wrong element and reports confident nonsense. So this
 * builds a page whose difference from the design is known in advance and
 * checks the diff names it.
 *
 * Opt-in (needs `velloo browser install`): `VELLOO_E2E=1 bun test`.
 */
const RUN = process.env.VELLOO_E2E === "1";
const viewport: Viewport = { w: 800, h: 600 };
const SCALE = 0.5;

/**
 * The design: a panel inset inside a padded root, so the panel is a strictly
 * smaller box than its parent. A panel coextensive with the root would tie on
 * area and the region would resolve to the root instead — which is correct
 * behaviour and a useless test.
 */
const screens = {
  card: {
    id: "card",
    name: "Card",
    tree: {
      $ref: "Box",
      props: { className: "w-full p-8 bg-background" },
      children: [
        {
          $id: "panel",
          $ref: "Box",
          props: { className: "w-full h-40 p-4 bg-primary" },
          children: [],
        },
      ],
    },
  },
};

/** The same page, but the panel has 40px of padding and is taller. */
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>
  *{box-sizing:border-box} html,body{margin:0;padding:0;background:#fff}
  .shell{width:100%;padding:32px}
  .panel{width:100%;height:240px;padding:40px;background:#000}
</style></head><body><div class="shell"><div class="panel"></div></div></body></html>`;

let harness: Awaited<ReturnType<typeof testContext>>;
let app: ReturnType<typeof createApp>;
let server: ReturnType<typeof Bun.serve>;
let url: string;

beforeAll(async () => {
  if (!RUN) return;
  harness = await testContext({ label: "style-diff", screens });
  const { folder, ctx } = harness;
  app = createApp(
    () => ctx,
    new TailwindJit(ctx.defaultProvider, join(folder.root, "screens")),
    new LiveBundler(
      folder.root,
      () => folder.config,
      () => liveExtensions(folder.config.extensions),
    ),
    new CanvasBundler(
      folder.root,
      () => folder.config.hostApp,
      () => undefined,
    ),
  );
  server = Bun.serve({
    port: 0,
    fetch: () => new Response(PAGE, { headers: { "Content-Type": "text/html" } }),
  });
  url = `http://127.0.0.1:${server.port}/`;
});

afterAll(async () => {
  server?.stop(true);
  await harness?.cleanup();
});

describe.skipIf(!RUN)("compare_to_url style diff (Playwright)", () => {
  test("names the design node and the properties that actually differ", async () => {
    const res = await app.fetch(
      new Request(
        `http://localhost/api/render/card?w=${viewport.w}&h=${viewport.h}&mode=light&canvas=1&v=1.0`,
        { headers: { origin: "http://localhost" } },
      ),
    );
    const html = await res.text();

    const [design, page] = await Promise.all([
      captureScreenshot({ html, viewport, fullPage: true, deviceScaleFactor: SCALE, dom: true }),
      captureUrlScreenshot({ url, viewport, fullPage: true, deviceScaleFactor: SCALE, dom: true }),
    ]);
    expect(design.dom).toBeDefined();
    expect(page.dom).toBeDefined();
    if (!design.dom || !page.dom) return;

    const screen = harness.ctx.folder.screens.get("card");
    if (!screen) throw new Error("fixture screen missing");
    const result = diffPngs(page.png, design.png);
    const regions = result.regions.map((r) => ({
      ...r,
      node: regionNode(r, design.nodeRects, SCALE, screen),
    }));

    const diff = styleDiffForRegions(regions, design.dom, page.dom, SCALE);
    expect(diff.length).toBeGreaterThan(0);

    // The panel is what differs, and it is addressable by the id it declares.
    const panel = diff.find((d) => d.node.includes("panel"));
    expect(panel).toBeDefined();
    // p-4 = 16px against the page's 40px — the fact the class string alone
    // could never confirm.
    expect(panel?.differs).toContainEqual({
      property: "padding",
      design: "16px",
      page: "40px",
    });
    // h-40 = 160px against 240px, reported as the box mismatch it is.
    expect(panel?.size).toEqual({ design: "736×160", page: "736×240" });
  }, 120_000);
});
