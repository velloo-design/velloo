import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { captureScreenshot, captureUrlScreenshot, diffPngs } from "@velloo/renderer";
import type { Viewport } from "@velloo/schema";
import { createApp } from "../app.ts";
import { CanvasBundler } from "../live/canvas-bundler.ts";
import { LiveBundler, liveExtensions } from "../live/component-bundler.ts";
import { diffText } from "../mcp/tools/text-diff.ts";
import { TailwindJit } from "../styles/tailwind-jit.ts";
import { testContext } from "../testing/design-folder.ts";

/**
 * The `compare_to_url` text diff, against a real page.
 *
 * The case it exists for: a page and its design that differ by one opening
 * hour. That is a few dozen pixels in a render of half a million, so the score
 * rounds to a match — and the one fact a customer would act on is the thing
 * the picture cannot show. The unit tests fix the matching; this checks that
 * two real walks (a Velloo render and a served page, marked up differently)
 * produce lines that can be matched at all.
 *
 * Opt-in (needs `velloo browser install`): `VELLOO_E2E=1 bun test`.
 */
const RUN = process.env.VELLOO_E2E === "1";
const viewport: Viewport = { w: 800, h: 600 };

const screens = {
  store: {
    id: "store",
    name: "Store",
    tree: {
      $ref: "Box",
      props: { className: "w-full p-8 bg-background" },
      children: [
        { $ref: "Box", props: { as: "h1", className: "text-2xl", children: "Visit the shop" } },
        {
          $id: "hours",
          $ref: "Box",
          props: { as: "p", className: "text-base" },
          children: [
            { $text: "Open " },
            { $ref: "Box", props: { as: "strong", children: "9am" } },
            { $text: " to 6pm, Monday to Friday" },
          ],
        },
        { $ref: "Box", props: { as: "p", className: "uppercase", children: "Free parking" } },
      ],
    },
  },
};

/** The same copy as the design except the closing hour, cut into different elements. */
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;padding:0;background:#fff;font-family:sans-serif}
  .shell{padding:32px} h1{font-size:24px;margin:0} p{font-size:16px;margin:0}
</style></head><body><div class="shell">
  <h1>Visit <span>the shop</span></h1>
  <p>Open <strong>9am</strong> to <em>5pm</em>, Monday to Friday</p>
  <p>FREE PARKING</p>
</div></body></html>`;

let harness: Awaited<ReturnType<typeof testContext>>;
let app: ReturnType<typeof createApp>;
let server: ReturnType<typeof Bun.serve>;

beforeAll(async () => {
  if (!RUN) return;
  harness = await testContext({ label: "text-diff", screens });
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
});

afterAll(async () => {
  server?.stop(true);
  await harness?.cleanup();
});

describe.skipIf(!RUN)("compare_to_url text diff (Playwright)", () => {
  test("names the one line whose copy differs, and nothing the markup merely cuts differently", async () => {
    const res = await app.fetch(
      new Request(
        `http://localhost/api/render/store?w=${viewport.w}&h=${viewport.h}&mode=light&canvas=1&v=1.0`,
        { headers: { origin: "http://localhost" } },
      ),
    );
    const [design, page] = await Promise.all([
      captureScreenshot({ html: await res.text(), viewport, fullPage: true, dom: true }),
      captureUrlScreenshot({
        url: `http://127.0.0.1:${server.port}/`,
        viewport,
        fullPage: true,
        dom: true,
      }),
    ]);
    if (!design.dom || !page.dom) throw new Error("expected both sides to carry a DOM extract");

    expect(diffText(design.dom, page.dom, { label: (path) => `@[${path}]` })).toEqual({
      changed: [
        {
          page: "Open 9am to 5pm, Monday to Friday",
          design: "Open 9am to 6pm, Monday to Friday",
          node: "@[1]",
        },
      ],
    });
    // The picture barely registers what the words make plain.
    expect(1 - diffPngs(page.png, design.png).changedRatio).toBeGreaterThan(0.97);
  }, 120_000);
});
